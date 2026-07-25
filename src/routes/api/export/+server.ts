import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntries, getProject } from '$lib/server/store';
import { exportEpub } from '$lib/server/epub/export';

export const GET: RequestHandler = async () => {
	const project = await getProject();
	const entries = await getEntries();
	if (!project || !entries) error(404, 'no project loaded');
	const epub = await exportEpub(project, entries);
	const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'book';
	const filename = encodeURIComponent(`${safeTitle}-ko.epub`);
	return new Response(new Uint8Array(epub), {
		headers: {
			'Content-Type': 'application/epub+zip',
			'Content-Disposition': `attachment; filename="book-ko.epub"; filename*=UTF-8''${filename}`
		}
	});
};
