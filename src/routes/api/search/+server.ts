import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { Block, Chapter } from '$lib/types';
import { getProject, persistNow, setBlock, snapshotProject } from '$lib/server/store';
import { editorDocDir, forEditor, sanitizeInlineHtml } from '$lib/server/sanitize';
import { innerXml, loadXml } from '$lib/server/xml';
import { broadcast } from '$lib/server/events';
import { isTranslationActive } from '$lib/server/codex';

const MAX_HITS = 200;

/** 태그를 지우고 눈으로 읽을 수 있는 텍스트만 (검색·미리보기용) */
function plain(html: string): string {
	return html.replace(/<[^>]*>/g, '');
}

function snippet(html: string, needle: string): string {
	const text = plain(html);
	const at = text.toLowerCase().indexOf(needle.toLowerCase());
	if (at < 0) return text.slice(0, 90);
	const from = Math.max(0, at - 30);
	return (from ? '…' : '') + text.slice(from, at + needle.length + 50);
}

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const where = url.searchParams.get('in') === 'source' ? 'source' : 'target';
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	if (!q) return json({ hits: [], truncated: false });

	const needle = q.toLowerCase();
	const hits: { chapterId: string; chapterTitle: string | null; blockId: string; text: string }[] =
		[];
	for (const chapter of project.chapters) {
		for (const block of chapter.blocks) {
			const html = where === 'source' ? block.sourceHtml : (block.targetHtml ?? '');
			if (!html || !plain(html).toLowerCase().includes(needle)) continue;
			hits.push({
				chapterId: chapter.id,
				chapterTitle: chapter.title,
				blockId: block.id,
				text: snippet(html, q)
			});
			if (hits.length >= MAX_HITS) return json({ hits, truncated: true });
		}
	}
	return json({ hits, truncated: false });
};

const replaceSchema = z.object({
	from: z.string().min(1).max(200),
	to: z.string().max(200),
	dryRun: z.boolean().default(true)
});

/**
 * 번역문만 일괄 치환한다. **텍스트 노드만** 건드리므로 `<em>`이나 `<a href>` 안쪽이
 * 치환어와 겹쳐도 마크업이 깨지지 않는다. 원문은 대상이 아니다(원문 보호).
 */
function replaceInText(html: string, from: string, to: string): { html: string; changed: boolean } {
	let changed = false;
	const $ = loadXml(`<root>${html}</root>`);
	for (const node of $('root').find('*').addBack().contents().toArray()) {
		if (node.type !== 'text') continue;
		const before = node.data ?? '';
		const after = before.split(from).join(to);
		if (after !== before) {
			node.data = after;
			changed = true;
		}
	}
	return { html: changed ? innerXml($('root')) : html, changed };
}

export const POST: RequestHandler = async ({ request }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	const parsed = replaceSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, '치환할 문자열이 올바르지 않습니다');
	const { from, to, dryRun } = parsed.data;

	const targets: { chapter: Chapter; block: Block; html: string }[] = [];
	for (const chapter of project.chapters) {
		for (const block of chapter.blocks) {
			if (!block.targetHtml) continue;
			const result = replaceInText(block.targetHtml, from, to);
			if (result.changed) targets.push({ chapter, block, html: result.html });
		}
	}
	if (dryRun || targets.length === 0) return json({ matched: targets.length, applied: 0 });

	// 되돌릴 지점을 먼저 남긴다 — 한 번에 여러 챕터가 바뀐다
	await snapshotProject(`"${from}" → "${to}" 치환 전`, false);
	const byChapter = new Map<Chapter, Block[]>();
	for (const t of targets) {
		setBlock(t.block, sanitizeInlineHtml(t.html), t.block.status);
		byChapter.set(t.chapter, [...(byChapter.get(t.chapter) ?? []), t.block]);
	}
	await persistNow();
	for (const [chapter, blocks] of byChapter) {
		const docDir = editorDocDir(chapter);
		broadcast({
			type: 'blocks',
			chapterId: chapter.id,
			blocks: blocks.map((b) => forEditor(b, docDir))
		});
	}
	return json({ matched: targets.length, applied: targets.length });
};
