import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLoadError, getProject } from '$lib/server/store';
import { projectSummary } from '$lib/types';

export const GET: RequestHandler = async () => {
	const project = await getProject();
	if (!project) error(getLoadError() ? 409 : 404, getLoadError() ?? 'no project loaded — upload an epub first');
	return json(projectSummary(project));
};
