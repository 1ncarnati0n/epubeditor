import type { CheerioAPI } from 'cheerio';
import type { Chapter } from '$lib/types';

export const BLOCK_TAGS = [
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'li',
	'blockquote',
	'figcaption',
	'dt',
	'dd',
	'th',
	'td',
	'caption'
];

const SELECTOR = BLOCK_TAGS.join(',');

/**
 * Document-order "leaf" block elements: tag is in BLOCK_TAGS, no descendant is,
 * and it has visible text. Deterministic — parse.ts (extract) and export.ts
 * (inject) both rely on this exact enumeration for the s#:b# id mapping.
 */
export function findBlockElements($: CheerioAPI) {
	return $('body')
		.find(SELECTOR)
		.filter((_, el) => $(el).find(SELECTOR).length === 0 && $(el).text().trim().length > 0);
}

/** 병기 모드에서 원문을 감싸는 클래스 — fonts.ts의 CSS와 짝이다 */
export const SOURCE_CLASS = 'epubeditor-src';

/**
 * 번역을 문서에 넣는다. 미리보기와 내보내기가 이 함수 하나를 공유해야
 * 화면에서 본 것이 그대로 EPUB으로 나간다.
 *
 * bilingual이면 번역문 뒤에 원문을 붙이는데, 형제 요소가 아니라 **같은 원소 안의 span**이다.
 * 블록 태그에는 li·td·th·dt도 있어서 형제 li는 목록 번호를, 형제 td는 표 열을 망가뜨린다.
 * span은 phrasing content라 p 안에서도 XHTML 유효하고 display:block으로 한 줄을 차지한다.
 */
export function injectTranslations($: CheerioAPI, chapter: Chapter, bilingual: boolean): void {
	findBlockElements($).each((j, el) => {
		const block = chapter.blocks[j];
		if (!block?.targetHtml || block.status === 'untranslated') return;
		// 번역한 뒤 원문이 바뀐 블록은 넣지 않는다 — 사람이 확인할 때까지 원문을 그대로 둔다
		if (block.stale) return;
		$(el).html(
			bilingual
				? `${block.targetHtml}<span class="${SOURCE_CLASS}">${block.sourceHtml}</span>`
				: block.targetHtml
		);
	});
}
