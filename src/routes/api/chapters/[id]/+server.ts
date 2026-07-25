import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findBlock, getChapter, setBlock } from '$lib/server/store';
import { forEditor, sanitizeInlineHtml } from '$lib/server/sanitize';
import { broadcast } from '$lib/server/events';
import type { BlockStatus } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
	const chapter = await getChapter(params.id);
	if (!chapter) error(404, `unknown chapter: ${params.id}`);
	return json({ ...chapter, blocks: chapter.blocks.map(forEditor) });
};

// human edit from the UI: update a block's translation and/or status
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		blockId?: string;
		targetHtml?: string;
		status?: BlockStatus;
	} | null;
	if (!body?.blockId) error(400, 'blockId required');
	const found = await findBlock(body.blockId);
	if (!found || found.chapter.id !== params.id) error(404, `unknown block: ${body.blockId}`);
	const { block } = found;

	if (typeof body.targetHtml === 'string') {
		const clean = sanitizeInlineHtml(body.targetHtml);
		const isEmpty = clean.replace(/<[^>]*>/g, '').trim().length === 0;
		if (isEmpty) setBlock(block, null, 'untranslated');
		else setBlock(block, clean, body.status ?? 'reviewed');
	} else if (body.status) {
		setBlock(block, block.targetHtml, body.status);
	} else {
		error(400, 'targetHtml or status required');
	}

	broadcast({ type: 'blocks', chapterId: params.id, blocks: [forEditor(block)] });
	return json(forEditor(block));
};
