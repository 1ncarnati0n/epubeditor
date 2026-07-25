import type * as cheerio from 'cheerio';
import { innerXml, loadXml } from '$lib/server/xml';

// Inline-level allowlist for translated block content (LLM or human input).
// Threat model is "LLM output hygiene" for a local single-user tool, not hostile users.
const ALLOWED_TAGS = new Set([
	'em',
	'strong',
	'i',
	'b',
	'span',
	'a',
	'br',
	'small',
	'sub',
	'sup',
	'code',
	'cite',
	'q',
	'abbr',
	'ruby',
	'rt',
	'rp',
	's',
	'u',
	'mark'
]);
const ALLOWED_ATTRS = new Set(['class', 'href', 'title', 'lang', 'xml:lang', 'id']);

function escapeText(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Keep allowed inline tags/attrs, unwrap unknown tags (text survives),
 * drop script/style entirely. Returns XHTML-safe markup.
 */
export function sanitizeInlineHtml(html: string): string {
	let $: cheerio.CheerioAPI;
	try {
		$ = loadXml(`<root>${html}</root>`);
	} catch {
		return escapeText(html); // unparseable -> keep the translation as plain text
	}
	$('script, style').remove();
	for (let changed = true; changed; ) {
		changed = false;
		$('root *').each((_, el) => {
			if (!ALLOWED_TAGS.has(el.tagName?.toLowerCase() ?? '')) {
				$(el).replaceWith($(el).contents());
				changed = true;
			}
		});
	}
	$('root *').each((_, el) => {
		for (const [name, value] of Object.entries(el.attribs ?? {})) {
			const lower = name.toLowerCase();
			if (!ALLOWED_ATTRS.has(lower) || (lower === 'href' && /^\s*(javascript|data):/i.test(value))) {
				delete el.attribs[name];
			}
		}
	});
	return innerXml($('root'));
}
