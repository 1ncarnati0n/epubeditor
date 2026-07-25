import type { CheerioAPI } from 'cheerio';

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
