import { z } from 'zod';

// SvelteKit의 +server.ts는 HTTP 메서드 외의 export를 허용하지 않아 여기에 둔다.
// /api/settings(부분 갱신)와 /api/project/file(작업파일 검증)이 같이 쓴다.

export const typographySchema = z
	.object({
		bodyFont: z.enum(['pretendard', 'noto-serif-kr']).nullable(),
		fontSizePercent: z.number().min(50).max(200),
		lineHeight: z.number().min(1).max(3),
		paraSpacingEm: z.number().min(0).max(3),
		textIndentEm: z.number().min(0).max(3),
		marginPercent: z.number().min(0).max(20),
		bilingual: z.boolean(),
		// CSS에 그대로 들어가므로 형태를 못박는다
		textColor: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.nullable()
	})
	.partial();

export const codexSchema = z
	.object({
		// 모델 slug는 Codex 카탈로그가 바뀌면 늘어나므로 enum으로 고정하지 않는다
		model: z.string().min(1).max(80).nullable(),
		effort: z.string().min(1).max(20).nullable(),
		batchSize: z.number().int().min(1).max(50),
		concurrency: z.number().int().min(1).max(4),
		fastTier: z.boolean()
	})
	.partial();

/** 번역 지침 — 프롬프트에 통째로 실리므로 길이만 제한한다 */
export const translationGuideSchema = z.string().max(4000);

/** 책마다 덮던 자리 */
export const sessionSchema = z
	.object({
		chapterId: z.string().max(40).nullable(),
		cursor: z.string().max(60).nullable(),
		filter: z.enum(['all', 'untranslated', 'machine', 'stale'])
	})
	.partial();
