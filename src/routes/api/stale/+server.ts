import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChapter, getProject, resolveStale, staleBlocks } from '$lib/server/store';
import { broadcast } from '$lib/server/events';
import { forEditor } from '$lib/server/sanitize';
import { isTranslationActive } from '$lib/server/codex';

export const GET: RequestHandler = async () => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	return json(staleBlocks(project));
};

/** 원문이 바뀐 번역을 확정(keep)하거나 버린다(discard). blockId 없으면 전부. */
export const POST: RequestHandler = async ({ request }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	const body = (await request.json().catch(() => null)) as {
		action?: 'keep' | 'discard';
		blockId?: string;
	} | null;
	if (body?.action !== 'keep' && body?.action !== 'discard') {
		error(400, 'action must be keep or discard');
	}
	const result = await resolveStale(body.action, body.blockId);
	for (const chapterId of result.chapterIds) {
		const chapter = await getChapter(chapterId);
		if (chapter) broadcast({ type: 'blocks', chapterId, blocks: chapter.blocks.map(forEditor) });
	}
	return json(result);
};
