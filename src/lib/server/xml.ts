import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

/** XHTML/OPF 공용 로더 (xmlMode 왕복 직렬화) */
export function loadXml(source: string): cheerio.CheerioAPI {
	return cheerio.load(source, { xml: true });
}

/**
 * dom-serializer는 xmlMode에서 비ASCII를 전부 숫자 엔티티로 바꾼다(&#xd55c; …).
 * 파일은 UTF-8이므로 리터럴로 되돌린다. &<>"' 로 디코드되는 것만 엔티티 유지 — XML 유효성 보존.
 */
export function decodeNumericEntities(xml: string): string {
	return xml.replace(/&#x([0-9a-fA-F]+);|&#(\d+);/g, (match, hex, dec) => {
		const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
		const ch = String.fromCodePoint(code);
		return /[&<>'"]/.test(ch) ? match : ch;
	});
}

/** innerHTML을 UTF-8 리터럴로 직렬화 */
export function innerXml(el: Cheerio<AnyNode>): string {
	return decodeNumericEntities(el.html() ?? '');
}

/** 문서 전체를 UTF-8 리터럴로 직렬화 */
export function docXml($: cheerio.CheerioAPI): string {
	return decodeNumericEntities($.html());
}
