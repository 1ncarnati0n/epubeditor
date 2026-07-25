import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteBook, openBook } from '$lib/server/store';
import { isTranslationActive } from '$lib/server/codex';
import { broadcast } from '$lib/server/events';
import { projectSummary } from '$lib/types';

/** 이 책으로 전환 */
export const POST: RequestHandler = async ({ params }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	try {
		const project = await openBook(params.bookId);
		broadcast({ type: 'project' });
		return json(projectSummary(project));
	} catch (reason) {
		error(400, reason instanceof Error ? reason.message : '책을 열지 못했습니다');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	try {
		await deleteBook(params.bookId);
	} catch (reason) {
		error(409, reason instanceof Error ? reason.message : '지우지 못했습니다');
	}
	return json({ ok: true });
};
