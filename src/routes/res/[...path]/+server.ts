import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntries } from '$lib/server/store';

const MIME: Record<string, string> = {
	xhtml: 'application/xhtml+xml',
	html: 'text/html',
	xml: 'application/xml',
	css: 'text/css',
	js: 'text/javascript',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	otf: 'font/otf',
	ttf: 'font/ttf',
	woff: 'font/woff',
	woff2: 'font/woff2'
};

// 원본 EPUB 내부 리소스(이미지·CSS 등)를 그대로 서빙
export const GET: RequestHandler = async ({ params }) => {
	const entries = await getEntries();
	const data = entries?.[params.path];
	if (!data) error(404, `no such resource: ${params.path}`);
	const ext = params.path.split('.').pop()?.toLowerCase() ?? '';
	return new Response(new Uint8Array(data), {
		headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' }
	});
};
