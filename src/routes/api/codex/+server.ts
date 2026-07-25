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
		blockId?: string;
	} | null;
	try {
		const mcpUrl = expectedMcpUrl(url);
		if (body?.action === 'connect') return json(await connectCodex(mcpUrl));
		if (body?.action === 'start') {
			const { scope } = body;
			if (scope === 'chapter' || scope === 'book') {
				return json(await startTranslation(mcpUrl, scope, body.chapterId), { status: 202 });
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
