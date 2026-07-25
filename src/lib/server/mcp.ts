import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { chapterSummary, type Block } from '$lib/types';
import { findBlock, getChapter, getProject, setBlock } from './store';
import { sanitizeInlineHtml } from './sanitize';
import { broadcast } from './events';

function jsonResult(data: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string) {
	return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const NO_BOOK = 'No book is loaded. Ask the user to open an EPUB in the editor first.';

/** stateless — 요청마다 새로 생성 (등록 비용은 무시 가능) */
export function createMcpServer(): McpServer {
	const server = new McpServer(
		{ name: 'epub-editor', version: '0.1.0' },
		{
			instructions:
				'English→Korean EPUB translation workbench. Workflow: list_chapters → get_blocks(chapterId) → translate each block → submit_translations. ' +
				'After submitting, call get_blocks again with offset 0 (the untranslated list shrinks as you submit). ' +
				'Translate literary prose naturally; the human reviews every block in the editor UI.'
		}
	);

	server.registerTool(
		'list_chapters',
		{
			title: '챕터 목록',
			description:
				'List the loaded book and its chapters with translation progress counts (total / untranslated / machine / reviewed blocks per chapter). Use this to pick a chapter and to check progress.',
			inputSchema: {}
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
				'Translate the text content into natural literary Korean and keep every inline tag (em, strong, a, span, br, ruby, …) and its attributes exactly as-is. ' +
				'Note: with status="untranslated" (default) the list shrinks as you submit — re-query with offset 0 after each submit_translations.',
			inputSchema: {
				chapterId: z.string().describe('chapter id from list_chapters, e.g. "s3"'),
				status: z.enum(['untranslated', 'machine', 'reviewed', 'all']).default('untranslated'),
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(50).default(20)
			}
		},
		async ({ chapterId, status, offset, limit }) => {
			const chapter = await getChapter(chapterId);
			if (!chapter) {
				const project = await getProject();
				return errorResult(project ? `Unknown chapter "${chapterId}". Call list_chapters.` : NO_BOOK);
			}
			const matching =
				status === 'all' ? chapter.blocks : chapter.blocks.filter((b) => b.status === status);
			const page = matching.slice(offset, offset + limit);
			return jsonResult({
				chapter: { id: chapter.id, title: chapter.title },
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
				'Submit Korean translations for blocks. targetHtml must mirror the inline markup of the block\'s sourceHtml (translate text, keep tags/attributes). ' +
				'Submitted blocks become status "machine" and appear in the editor UI instantly. ' +
				'Blocks the human already marked "reviewed" are skipped unless overwriteReviewed=true.',
			inputSchema: {
				translations: z
					.array(z.object({ id: z.string(), targetHtml: z.string() }))
					.min(1)
					.max(50),
				overwriteReviewed: z.boolean().default(false)
			}
		},
		async ({ translations, overwriteReviewed }) => {
			if (!(await getProject())) return errorResult(NO_BOOK);
			const results: { id: string; ok: boolean; error?: string }[] = [];
			const changedByChapter = new Map<string, Block[]>();
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
				const list = changedByChapter.get(found.chapter.id) ?? [];
				list.push(found.block);
				changedByChapter.set(found.chapter.id, list);
			}
			for (const [chapterId, blocks] of changedByChapter) {
				broadcast({ type: 'blocks', chapterId, blocks });
			}
			const accepted = results.filter((r) => r.ok).length;
			return jsonResult({ accepted, skipped: results.length - accepted, results });
		}
	);

	return server;
}
