import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listBooks } from '$lib/server/store';

/** 책장 — data/ 에 쌓인 작업들 */
export const GET: RequestHandler = async () => json(await listBooks());
