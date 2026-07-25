import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, listSnapshots, snapshotProject } from '$lib/server/store';
import { isTranslationActive } from '$lib/server/codex';

export const GET: RequestHandler = async () => json(await listSnapshots());

export const POST: RequestHandler = async ({ request }) => {
	if (!(await getProject())) error(404, 'no project loaded');
	if (isTranslationActive()) error(409, 'Codex 번역 중에는 스냅샷을 만들 수 없습니다');
	const body = (await request.json().catch(() => null)) as { label?: string } | null;
	const label = (body?.label ?? '').trim().slice(0, 60) || '수동 저장';
	return json(await snapshotProject(label, false));
};
