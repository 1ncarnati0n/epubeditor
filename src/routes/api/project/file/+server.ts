import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getProject, importWorkFile } from '$lib/server/store';
import { sanitizeInlineHtml } from '$lib/server/sanitize';
import { broadcast } from '$lib/server/events';
import { isTranslationActive } from '$lib/server/codex';
import { codexSchema, translationGuideSchema, typographySchema } from '$lib/server/schemas';

/** 신뢰 경계: 밖에서 온 파일이므로 읽는 필드를 전부 검증한다 */
const settings = {
	typography: typographySchema.optional(),
	codex: codexSchema.optional(),
	translationGuide: translationGuideSchema.optional()
};

/** v2 — 번역 맵만. 원문 필드가 스키마에 아예 없으므로 원문을 되돌려 넣을 수 없다 */
const v2 = z.object({
	version: z.literal(2),
	bookId: z.string(),
	epubSha256: z.string().optional(),
	translations: z.record(
		z.string(),
		z.object({
			targetHtml: z.string(),
			status: z.enum(['untranslated', 'machine', 'reviewed']),
			updatedAt: z.number(),
			srcHash: z.string()
		})
	),
	...settings
});

/** v1 — 원문 사본까지 담겼던 옛 형식. 받아주되 원문은 버린다 */
const v1 = z.object({
	version: z.literal(1),
	bookId: z.string(),
	chapters: z.array(
		z.object({
			blocks: z.array(
				z.object({
					id: z.string(),
					sourceHtml: z.string().optional(),
					targetHtml: z.string().nullable(),
					status: z.enum(['untranslated', 'machine', 'reviewed']),
					updatedAt: z.number()
				})
			)
		})
	),
	...settings
});

const workFileSchema = z.union([v2, v1]);

export const GET: RequestHandler = async () => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	const name = `${project.title.replace(/[^\p{L}\p{N} _-]/gu, '') || 'book'}-${project.bookId}.epubtrans.json`;
	return new Response(JSON.stringify(project), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="work.epubtrans.json"; filename*=UTF-8''${encodeURIComponent(name)}`
		}
	});
};

export const POST: RequestHandler = async ({ request }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	const parsed = workFileSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, '작업파일 형식이 올바르지 않습니다');
	let applied: number;
	try {
		applied = await importWorkFile(parsed.data, sanitizeInlineHtml);
	} catch (reason) {
		error(409, reason instanceof Error ? reason.message : '작업파일을 적용하지 못했습니다');
	}
	broadcast({ type: 'project' });
	return json({ applied });
};
