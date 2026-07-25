import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, getSourceEpub } from '$lib/server/store';

/** 원본 EPUB 그대로 — 번역본이 아니라 처음 올린 파일이다 */
export const GET: RequestHandler = async () => {
	const [project, epub] = await Promise.all([getProject(), getSourceEpub()]);
	if (!project || !epub) error(404, 'no project loaded');
	const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'book';
	const filename = encodeURIComponent(`${safeTitle}-원본.epub`);
	return new Response(new Uint8Array(epub), {
		headers: {
			'Content-Type': 'application/epub+zip',
			'Content-Disposition': `attachment; filename="book-source.epub"; filename*=UTF-8''${filename}`
		}
	});
};
