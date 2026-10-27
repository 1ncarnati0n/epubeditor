import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { CodexTranslationScope } from '$lib/types';
import {
	CodexRunnerError,
	connectCodex,
	expectedMcpUrl,
	getCodexStatus,
	startTranslation,
	stopTranslation
} from '$lib/server/codex';
import { isPdfJobActive } from '$lib/server/pdf';

function fail(reason: unknown): never {
	if (reason instanceof CodexRunnerError) error(reason.status, reason.message);
	error(500, reason instanceof Error ? reason.message : String(reason));
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		return json(await getCodexStatus(expectedMcpUrl(url)));
	} catch (reason) {
		fail(reason);
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	const body = (await request.json().catch(() => null)) as {
		action?: 'connect' | 'start';
		scope?: CodexTranslationScope;
		chapterId?: string;
		chapterIds?: unknown;
		blockId?: string;
	} | null;
	// 변환이 끝나면 책이 바뀐다 — 그 사이에 옛 책을 번역하면 결과가 엉뚱한 책으로 간다.
	// try 밖이어야 한다: 안에서 던지면 fail()이 500으로 바꾼다
	if (body?.action === 'start' && isPdfJobActive()) error(409, 'PDF 변환이 끝난 뒤에 번역하세요');
	try {
		const mcpUrl = expectedMcpUrl(url);
		if (body?.action === 'connect') return json(await connectCodex(mcpUrl));
		if (body?.action === 'start') {
			const { scope } = body;
			if (scope === 'chapter' || scope === 'book') {
				// 없는 id는 startTranslation의 필터에서 저절로 떨어진다 — 모양과 크기만 막는다
				const only = Array.isArray(body.chapterIds)
					? body.chapterIds.filter((id) => typeof id === 'string').slice(0, 2000)
					: undefined;
				return json(await startTranslation(mcpUrl, scope, body.chapterId, only), { status: 202 });
			}
			if (scope === 'block') {
				return json(await startTranslation(mcpUrl, scope, body.blockId), { status: 202 });
			}
		}
		error(400, 'action must be connect or start');
	} catch (reason) {
		fail(reason);
	}
};

export const DELETE: RequestHandler = () => json(stopTranslation());
