import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/store';
import { projectSummary } from '$lib/types';

export const GET: RequestHandler = async () => {
	const project = await getProject();
	if (!project) error(404, 'no project loaded — upload an epub first');
	return json(projectSummary(project));
};
