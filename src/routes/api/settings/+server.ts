import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, scheduleSave } from '$lib/server/store';
import { codexSchema, translationGuideSchema, typographySchema } from '$lib/server/schemas';

const patchSchema = typographySchema.extend({
	codex: codexSchema.optional(),
	translationGuide: translationGuideSchema.optional()
});

export const PATCH: RequestHandler = async ({ request }) => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	const parsed = patchSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid settings patch');
	const { codex, translationGuide, ...typography } = parsed.data;
	Object.assign(project.typography, typography);
	if (codex) Object.assign(project.codex, codex);
	if (translationGuide !== undefined) project.translationGuide = translationGuide;
	scheduleSave();
	return json({
		typography: project.typography,
		codex: project.codex,
		translationGuide: project.translationGuide
	});
};
