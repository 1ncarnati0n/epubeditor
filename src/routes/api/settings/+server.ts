import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, scheduleSave, setSession } from '$lib/server/store';
import {
	bookMetaSchema,
	codexSchema,
	sessionSchema,
	translationGuideSchema,
	typographySchema
} from '$lib/server/schemas';

const patchSchema = typographySchema.extend({
	codex: codexSchema.optional(),
	translationGuide: translationGuideSchema.optional(),
	session: sessionSchema.optional(),
	meta: bookMetaSchema.optional()
});

export const PATCH: RequestHandler = async ({ request }) => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded');
	const parsed = patchSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid settings patch');
	const { codex, translationGuide, session, meta, ...typography } = parsed.data;
	Object.assign(project.typography, typography);
	if (codex) Object.assign(project.codex, codex);
	if (translationGuide !== undefined) project.translationGuide = translationGuide;
	// 제목은 파일명·dc:title로 나가므로 공백뿐이면 예전 값을 지킨다. 저자는 비우면 항목을 없앤다.
	if (meta?.title !== undefined) project.title = meta.title.trim() || project.title;
	if (meta?.creator !== undefined) project.creator = meta.creator?.trim() || null;
	if (session) setSession(session);
	scheduleSave();
	return json({
		title: project.title,
		creator: project.creator,
		typography: project.typography,
		codex: project.codex,
		translationGuide: project.translationGuide,
		session: project.session
	});
};
