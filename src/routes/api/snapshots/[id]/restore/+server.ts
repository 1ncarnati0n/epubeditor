import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restoreSnapshot } from '$lib/server/store';
import { isTranslationActive } from '$lib/server/codex';
import { broadcast } from '$lib/server/events';

export const POST: RequestHandler = async ({ params }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	if (!(await restoreSnapshot(params.id))) error(404, '스냅샷을 찾지 못했습니다');
	broadcast({ type: 'project' });
	return json({ ok: true });
};
