import path from 'node:path';
import type * as cheerio from 'cheerio';
import type { Chapter } from '$lib/types';
import { innerXml, loadXml } from '$lib/server/xml';
import { resUrl } from '$lib/server/epub/parse';

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
	'mark',
	// 수학책은 문단 한복판에 수식을 이미지로 박는다 (한 권에 14,000개짜리도 있다).
	// 빼면 img는 자식이 없어 통째로 사라진다 — 번역하는 순간 수식이 증발한다.
	'img'
]);
/**
 * 이 안쪽은 손대지 않는다. MathML은 태그가 서른 개가 넘고 속성까지 전부 표현이라
 * 하나씩 허용목록에 올리는 건 지는 싸움이다. `closest`는 자기 자신을 포함하므로
 * 이 선택자 하나가 `<math>` 자체와 모든 자손을 함께 통과시킨다.
 */
const KEEP_SUBTREE = 'math, svg';
const ALLOWED_ATTRS = new Set([
	'class',
	'href',
	'title',
	'lang',
	'xml:lang',
	'id',
	// img용. style은 인라인 수식의 height·vertical-align이라 빼면 글줄에서 붕 뜬다.
	'src',
	'alt',
	'width',
	'height',
	'style'
]);

function escapeText(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * 편집기로 내보낼 블록. 원문은 남의 EPUB에서 온 신뢰할 수 없는 HTML이고 왼쪽 칸은
 * `{@html}`로 앱 오리진에 렌더되므로, **표시용으로만** 새니타이즈한다.
 * 저장·내보내기·MCP는 원문 그대로 쓴다 (충실도가 중요한 곳).
 */
export function forEditor<T extends { sourceHtml: string }>(block: T, docDir: string): T {
	return { ...block, sourceHtml: sanitizeInlineHtml(block.sourceHtml, docDir) };
}

/** 한 chapter의 블록 전부 — 호출처 넷이 전부 이 꼴이라 docDir 계산을 여기 모은다 */
export function forEditorAll(chapter: Chapter) {
	const docDir = path.posix.dirname(chapter.href);
	return chapter.blocks.map((block) => forEditor(block, docDir));
}

export function editorDocDir(chapter: Chapter): string {
	return path.posix.dirname(chapter.href);
}

/**
 * docDir을 주면 = 표시용으로 불렸다는 뜻이라 상대 `src`를 `/res/…`로 옮긴다.
 * 저장 경로(제출된 번역)는 절대 주지 않는다 — 저장된 값은 원래 상대경로여야
 * 내보낸 EPUB 안에서 맞는다.
 */
export function sanitizeInlineHtml(html: string, docDir?: string): string {
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
			if ($(el).closest(KEEP_SUBTREE).length) return;
			if (!ALLOWED_TAGS.has(el.tagName?.toLowerCase() ?? '')) {
				$(el).replaceWith($(el).contents());
				changed = true;
			}
		});
	}
	$('root *').each((_, el) => {
		// math/svg 안쪽은 표현 속성을 그대로 두지만, **실행되는 것은 예외 없이 지운다**.
		// 이 결과는 BlockRow가 {@html}로 앱 오리진에 넣으므로 <svg onload>는 <script> 없이도
		// 도는 진짜 실행 경로다. 원문은 남의 EPUB에서 온 신뢰할 수 없는 HTML이다.
		const inKept = $(el).closest(KEEP_SUBTREE).length > 0;
		for (const [name, value] of Object.entries(el.attribs ?? {})) {
			const lower = name.toLowerCase();
			if (lower.startsWith('on') || /^\s*javascript:/i.test(value)) {
				delete el.attribs[name];
				continue;
			}
			if (inKept) continue;
			// href는 data:도 막는다 (data:text/html 이 새 문서를 연다). src는 data: 이미지가 정상.
			if (!ALLOWED_ATTRS.has(lower) || (lower === 'href' && /^\s*data:/i.test(value))) {
				delete el.attribs[name];
			}
		}
	});
	if (docDir !== undefined) {
		$('img[src]').each((_, el) => {
			el.attribs['src'] = resUrl(docDir, el.attribs['src']) ?? el.attribs['src'];
		});
	}
	return innerXml($('root'));
}
