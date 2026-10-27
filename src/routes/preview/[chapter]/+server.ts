import { error } from '@sveltejs/kit';
import path from 'node:path';
import { strFromU8 } from 'fflate';
import type { RequestHandler } from './$types';
import { getChapter, getEntries, getProject } from '$lib/server/store';
import { resolveHref, resUrl } from '$lib/server/epub/parse';
import { injectTranslations } from '$lib/server/epub/blocks';
import { docXml, loadXml } from '$lib/server/xml';
import { typographyCss } from '$lib/server/fonts';

// 번역 주입 + 리소스 경로 재작성 + 조판 CSS 주입한 챕터 XHTML (iframe 미리보기용)
export const GET: RequestHandler = async ({ params, url }) => {
	const project = await getProject();
	const chapter = await getChapter(params.chapter);
	const entries = await getEntries();
	const bytes = chapter && entries?.[chapter.href];
	if (!project || !chapter || !bytes) error(404, 'chapter not found');

	const $ = loadXml(strFromU8(bytes));

	injectTranslations($, chapter, project.typography.bilingual);

	// 이미지·스타일시트 경로를 /res/ 로 재작성 (절대 URL·앵커·data:는 그대로).
	// injectTranslations가 먼저 돌았으므로 **번역문 안에 살아남은 <img>도 여기서 함께 고쳐진다.**
	// 순서를 바꾸면 번역한 문단의 수식 이미지만 깨진다.
	const docDir = path.posix.dirname(chapter.href);
	const rewrite = (val: string | undefined) => resUrl(docDir, val);
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

	/*
	 * 본문 링크(각주·상호참조·색인)를 살린다. 그냥 두면 `chapter4.xhtml#fn4_1`이
	 * iframe 기준으로 `/preview/chapter4.xhtml`이 되어 404다 — 한 권에 수백~수천 개다.
	 * 같은 문서를 파일명으로 가리키는 각주도 흔해서(한 책은 548개 중 324개), 그 경우
	 * 앵커만 남겨 문서를 다시 불러오지 않게 한다.
	 */
	const idByHref = new Map(project.chapters.map((c) => [c.href, c.id]));
	$('a[href]').each((_, el) => {
		const raw = el.attribs['href'];
		if (!raw || /^(#|[a-z][a-z0-9+.-]*:)/i.test(raw)) return;
		const id = idByHref.get(resolveHref(docDir, raw));
		if (!id) return; // spine에 없는 문서 — /res/로 보내면 날것의 XHTML이라 404보다 나을 게 없다
		const hash = raw.indexOf('#');
		const frag = hash < 0 ? '' : raw.slice(hash);
		el.attribs['href'] = id === chapter.id ? frag || '#' : `/preview/${id}${frag}`;
	});

	// ?base: 글자 크기 덮어쓰기 없이 — 조판 패널이 책 원본 본문 크기를 재는 용도
	const t = url.searchParams.has('base') ? { ...project.typography, fontSizePx: null } : project.typography;
	const css = typographyCss(t, (file) => `/fonts/${file}`, 'opentype', true);
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
