import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { persistNow, saveState } from '$lib/server/store';

export const GET: RequestHandler = () => json(saveState());

/** 수동 저장 — 자동 저장(500ms debounce)을 기다리지 않고 지금 디스크에 쓴다 */
export const POST: RequestHandler = async () => {
	await persistNow();
	return json(saveState());
};
