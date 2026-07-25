import { strFromU8, strToU8, zipSync, type Zippable } from 'fflate';
import subsetFont from 'subset-font';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '$lib/types';
import { findOpfPath, resolveHref } from './parse';
import { injectTranslations } from './blocks';
import { docXml, loadXml } from '$lib/server/xml';
import { fontById, typographyCss } from '../fonts';

const FONTS_SRC_DIR = path.resolve('static/fonts');

/** 번역 주입 + 조판 CSS/폰트 임베드 + OPF 갱신 → 새 EPUB zip */
export async function exportEpub(
	project: Project,
	entries: Record<string, Uint8Array>
): Promise<Uint8Array> {
	const opfPath = findOpfPath(entries);
	const opfDir = path.posix.dirname(opfPath);
	const inOpf = (rel: string) => (opfDir === '.' ? rel : `${opfDir}/${rel}`);
	const cssPath = inOpf('css/epubeditor.css');
	const font = fontById(project.typography.bodyFont);

	const modified = new Map<string, string>(); // zip 경로 -> 새 XHTML
	let allText = ''; // 폰트 서브셋용 — 내보내는 문서의 최종 텍스트 전부

	for (const chapter of project.chapters) {
		const bytes = entries[chapter.href];
		if (!bytes) continue;
		const $ = loadXml(strFromU8(bytes));
		injectTranslations($, chapter, project.typography.bilingual);
		// 조판 스타일시트를 마지막 <link>로 주입 (기존 스타일 뒤에 와야 이김)
		const relCss = path.posix.relative(path.posix.dirname(chapter.href), cssPath);
		const head = $('head');
		if (head.length) head.append(`<link rel="stylesheet" type="text/css" href="${relCss}"/>`);
		allText += $('body').text();
		modified.set(chapter.href, docXml($));
	}

	// OPF: manifest에 CSS(+폰트) 등록, 본문 언어를 ko로
	const $opf = loadXml(strFromU8(entries[opfPath]));
	const manifest = $opf('manifest').first();
	manifest.append(
		`<item id="epubeditor-css" href="css/epubeditor.css" media-type="text/css"/>`
	);
	const fontFiles: { file: string; woff2: string; data?: Uint8Array }[] = (font?.files ?? []).map(
		(f, i) => ({ file: f.file, woff2: f.file.replace(/\.otf$/, '.woff2') })
	);
	fontFiles.forEach(({ woff2 }, i) => {
		manifest.append(
			`<item id="epubeditor-font-${i}" href="fonts/${woff2}" media-type="font/woff2"/>`
		);
	});
	const lang = $opf('dc\\:language').first();
	if (lang.length) lang.text('ko');

	// 폰트 서브셋 (한국어 단행본 기준 수백 KB)
	if (font) {
		const chars = [...new Set(allText + project.title + printableAscii())].join('');
		for (const f of fontFiles) {
			const src = await readFile(path.join(FONTS_SRC_DIR, f.file));
			f.data = new Uint8Array(
				await subsetFont(src, chars, { targetFormat: 'woff2' })
			);
		}
	}

	// zip 재조립 — mimetype는 무압축·첫 엔트리 (EPUB OCF 규격)
	const files: Zippable = {
		mimetype: [strToU8('application/epub+zip'), { level: 0 }]
	};
	for (const [name, data] of Object.entries(entries)) {
		if (name === 'mimetype') continue;
		files[name] = modified.has(name) ? strToU8(modified.get(name)!) : data;
	}
	files[opfPath] = strToU8(docXml($opf));
	files[cssPath] = strToU8(
		typographyCss(project.typography, (file) => `../fonts/${file.replace(/\.otf$/, '.woff2')}`, 'woff2')
	);
	for (const f of fontFiles) {
		if (f.data) files[inOpf(`fonts/${f.woff2}`)] = f.data;
	}
	return zipSync(files, { level: 6 });
}

function printableAscii(): string {
	let s = '';
	for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
	return s;
}
