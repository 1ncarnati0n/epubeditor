import { error } from '@sveltejs/kit';
import path from 'node:path';
import { strFromU8 } from 'fflate';
import type { RequestHandler } from './$types';
import { getChapter, getEntries, getProject } from '$lib/server/store';
import { resolveHref } from '$lib/server/epub/parse';
import { injectTranslations } from '$lib/server/epub/blocks';
import { docXml, loadXml } from '$lib/server/xml';
import { typographyCss } from '$lib/server/fonts';

// 번역 주입 + 리소스 경로 재작성 + 조판 CSS 주입한 챕터 XHTML (iframe 미리보기용)
export const GET: RequestHandler = async ({ params }) => {
	const project = await getProject();
	const chapter = await getChapter(params.chapter);
	const entries = await getEntries();
	const bytes = chapter && entries?.[chapter.href];
	if (!project || !chapter || !bytes) error(404, 'chapter not found');

	const $ = loadXml(strFromU8(bytes));

	injectTranslations($, chapter, project.typography.bilingual);

	// 이미지·스타일시트 경로를 /res/ 로 재작성 (절대 URL·앵커·data:는 그대로)
	const docDir = path.posix.dirname(chapter.href);
	const rewrite = (val: string | undefined): string | undefined => {
		if (!val || /^(#|[a-z][a-z0-9+.-]*:)/i.test(val)) return val;
		return '/res/' + resolveHref(docDir, val);
	};
	$('[src]').each((_, el) => {
		el.attribs['src'] = rewrite(el.attribs['src']) ?? el.attribs['src'];
	});
	$('link[href]').each((_, el) => {
		el.attribs['href'] = rewrite(el.attribs['href']) ?? el.attribs['href'];
	});
	$('image').each((_, el) => {
		for (const key of ['xlink:href', 'href']) {
			if (el.attribs[key]) el.attribs[key] = rewrite(el.attribs[key]) ?? el.attribs[key];
		}
	});

	const css = typographyCss(project.typography, (file) => `/fonts/${file}`, 'opentype', true);
	const head = $('head');
	if (head.length) head.append(`<style>${css}</style>`);
	else $.root().append(`<style>${css}</style>`);

	return new Response(docXml($), {
		headers: {
			'Content-Type': 'application/xhtml+xml; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
};
