import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openEpub } from '$lib/server/store';
import { projectSummary } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) error(400, 'multipart field "file" (epub) required');
	try {
		const project = await openEpub(new Uint8Array(await file.arrayBuffer()));
		return json(projectSummary(project));
	} catch (e) {
		error(400, `not a valid EPUB: ${e instanceof Error ? e.message : String(e)}`);
	}
};
