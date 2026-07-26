import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { chapterSummary, type Block, type Chapter } from '$lib/types';
import { findBlock, getChapter, getProject, setBlock } from './store';
import { editorDocDir, forEditor, sanitizeInlineHtml } from './sanitize';
import { broadcast } from './events';

function jsonResult(data: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string) {
	return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const NO_BOOK = 'No book is loaded. Ask the user to open an EPUB in the editor first.';

/** 사람이 UI에 적은 문체·용어 규칙. 번역 직전에 보라고 get_blocks 응답에도 싣는다. */
const GUIDE_RULE =
	'When a response includes "translationGuide", follow it exactly — it is the human\'s binding style and terminology rule for this book, and it outranks your own preferences.';

/** stateless — 요청마다 새로 생성하므로 그때그때의 프로젝트 지침을 담을 수 있다 */
export async function createMcpServer(): Promise<McpServer> {
	const guide = (await getProject())?.translationGuide?.trim() ?? '';
	const server = new McpServer(
		{ name: 'epub-editor', version: '0.1.0' },
		{
			instructions:
				'English→Korean EPUB translation workbench. Workflow: list_chapters → get_blocks(chapterId) → translate each block → submit_translations. ' +
				'After submitting, call get_blocks again with offset 0 (the untranslated list shrinks as you submit). ' +
				'Translate literary prose naturally; the human reviews every block in the editor UI.' +
				// 이 문자열은 initialize 응답이라 클라이언트가 캐시한다 — 편집 중 갱신은 get_blocks 쪽이 담당
				(guide ? `\n\nTranslation guide from the human for the open book:\n${guide}` : '')
		}
	);

	server.registerTool(
		'list_chapters',
		{
			title: '챕터 목록',
			description:
				'List the loaded book and its chapters with translation progress counts (total / untranslated / machine / reviewed blocks per chapter). Use this to pick a chapter and to check progress.',
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async () => {
			const project = await getProject();
			if (!project) return errorResult(NO_BOOK);
			return jsonResult({
				title: project.title,
				language: project.language,
				creator: project.creator,
				chapters: project.chapters.map(chapterSummary)
			});
		}
	);

	server.registerTool(
		'get_blocks',
		{
			title: '블록 가져오기',
			description:
				'Get source blocks of a chapter as XHTML fragments. Each block is one paragraph/heading/list item. ' +
				'Translate the text content into natural literary Korean and keep every inline tag and its attributes exactly as-is — ' +
				'this includes <img> (math books set equations as inline images), <math>/MathML and <svg> subtrees, as well as em, strong, a, span, br, ruby. ' +
				'Never drop or rewrite them; copy them verbatim into the translation at the matching position. ' +
				`${GUIDE_RULE} ` +
				'Note: with status="untranslated" (default) the list shrinks as you submit — re-query with offset 0 after each submit_translations.',
			inputSchema: {
				chapterId: z.string().describe('chapter id from list_chapters, e.g. "s3"'),
				status: z.enum(['untranslated', 'machine', 'reviewed', 'all']).default('untranslated'),
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(50).default(20),
				blockIds: z
					.array(z.string())
					.max(50)
					.optional()
					.describe('specific block ids to fetch; when given, status/offset/limit are ignored')
			},
			annotations: { readOnlyHint: true, openWorldHint: false }
		},
		async ({ chapterId, status, offset, limit, blockIds }) => {
			const chapter = await getChapter(chapterId);
			if (!chapter) {
				const project = await getProject();
				return errorResult(project ? `Unknown chapter "${chapterId}". Call list_chapters.` : NO_BOOK);
			}
			const wanted = blockIds && new Set(blockIds);
			const matching = wanted
				? chapter.blocks.filter((b) => wanted.has(b.id))
				: status === 'all'
					? chapter.blocks
					: chapter.blocks.filter((b) => b.status === status);
			const page = wanted ? matching : matching.slice(offset, offset + limit);
			// 번역 직전에 매번 호출되는 곳이라, 사람이 지침을 고치면 여기로 즉시 반영된다
			const guide = (await getProject())?.translationGuide?.trim();
			return jsonResult({
				chapter: { id: chapter.id, title: chapter.title },
				...(guide ? { translationGuide: guide } : {}),
				totalMatching: matching.length,
				offset,
				returned: page.length,
				blocks: page.map(({ id, tag, sourceHtml, targetHtml, status: s }) => ({
					id,
					tag,
					sourceHtml,
					targetHtml,
					status: s
				}))
			});
		}
	);

	server.registerTool(
		'submit_translations',
		{
			title: '번역 제출',
			description:
				"Submit Korean translations for blocks. targetHtml must mirror the inline markup of the block's sourceHtml (translate text, keep tags/attributes). " +
				'<img>, <math> and <svg> must be copied verbatim — dropping them destroys equations and figures. ' +
				`${GUIDE_RULE} ` +
				'Submitted blocks become status "machine" and appear in the editor UI instantly. ' +
				'Blocks the human already marked "reviewed" are skipped unless overwriteReviewed=true.',
			inputSchema: {
				translations: z
					.array(z.object({ id: z.string(), targetHtml: z.string() }))
					.min(1)
					.max(50),
				overwriteReviewed: z.boolean().default(false)
			},
			annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
		},
		async ({ translations, overwriteReviewed }) => {
			if (!(await getProject())) return errorResult(NO_BOOK);
			const results: { id: string; ok: boolean; error?: string }[] = [];
				// 표시용 재작성에 chapter의 경로가 필요하다 — id만으론 부족해서 chapter를 같이 든다
				const changedByChapter = new Map<string, { chapter: Chapter; blocks: Block[] }>();
			for (const { id, targetHtml } of translations) {
				const found = await findBlock(id);
				if (!found) {
					results.push({ id, ok: false, error: 'unknown-block' });
					continue;
				}
				if (found.block.status === 'reviewed' && !overwriteReviewed) {
					results.push({ id, ok: false, error: 'reviewed-locked' });
					continue;
				}
				setBlock(found.block, sanitizeInlineHtml(targetHtml), 'machine');
				results.push({ id, ok: true });
				const entry = changedByChapter.get(found.chapter.id) ?? {
					chapter: found.chapter,
					blocks: [] as Block[]
				};
				entry.blocks.push(found.block);
				changedByChapter.set(found.chapter.id, entry);
			}
			for (const [chapterId, { chapter, blocks }] of changedByChapter) {
				const docDir = editorDocDir(chapter);
				broadcast({ type: 'blocks', chapterId, blocks: blocks.map((b) => forEditor(b, docDir)) });
			}
			const accepted = results.filter((r) => r.ok).length;
			return jsonResult({ accepted, skipped: results.length - accepted, results });
		}
	);

	return server;
}
