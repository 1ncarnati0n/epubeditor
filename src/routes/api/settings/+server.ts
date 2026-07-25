import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getProject, scheduleSave } from '$lib/server/store';

const patchSchema = z
	.object({
		bodyFont: z.enum(['pretendard', 'noto-serif-kr']).nullable(),
		fontSizePercent: z.number().min(50).max(200),
		lineHeight: z.number().min(1).max(3),
		paraSpacingEm: z.number().min(0).max(3),
		textIndentEm: z.number().min(0).max(3),
		marginPercent: z.number().min(0).max(20)
	})
	.partial();

export const PATCH: RequestHandler = async ({ request }) => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	const parsed = patchSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid typography patch');
	Object.assign(project.typography, parsed.data);
	scheduleSave();
	return json(project.typography);
};
