// 번역문 저장 왕복 점검: 편집 칸에서 돌아온 HTML(브라우저 직렬화)이 저장 형태로 그대로 돌아오는지 본다.
// 실행: node scripts/check-res-roundtrip.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
	server: { middlewareMode: true, hmr: false, watch: null },
	appType: 'custom',
	logLevel: 'silent'
});

try {
	const { forEditor, relativizeInlineHtml, sanitizeInlineHtml } = await server.ssrLoadModule(
		'/src/lib/server/sanitize.ts'
	);
	const shown = (html, docDir) => forEditor({ sourceHtml: '', targetHtml: html }, docDir).targetHtml;
	// 브라우저 innerHTML은 빈 요소를 `/>` 없이 쓴다
	const browser = (html) => html.replace(/<(img|br)\b([^>]*?)\s*\/>/g, '<$1$2>');
	// 편집 칸에서 저장까지: 표시형 → 브라우저 직렬화 → 저장형
	const editRoundTrip = (stored, docDir) =>
		sanitizeInlineHtml(relativizeInlineHtml(browser(shown(stored, docDir)), docDir));

	// 원문과 같은 폴더(OEBPS)와 한 단계 아래(OEBPS/Text) 두 경우 모두 되돌아와야 한다
	for (const [docDir, src] of [
		['OEBPS', 'images/B1/si3.svg'],
		['OEBPS/Text', '../images/B1/si3.svg']
	]) {
		const stored = sanitizeInlineHtml(`<span><img alt="Equation" src="${src}" class="si3"/></span>`);
		assert.match(shown(stored, docDir), /src="\/res\/OEBPS\/images\/B1\/si3\.svg"/);
		assert.equal(editRoundTrip(stored, docDir), stored);
	}
	// 수식 뒤에 번호가 붙는 블록: 브라우저의 `<img>`가 번호를 자기 안에 넣지 않아야 한다
	const numbered =
		'<img alt="Equation" src="images/B1/si3.svg" class="si3"/><span class="eqnum">(1.1) </span>';
	assert.equal(editRoundTrip(numbered, 'OEBPS'), numbered);
	// 줄바꿈 `<br>`도 같은 경로: 뒤 글이 br 안으로 들어가면 안 된다
	assert.equal(editRoundTrip('a<br/>b', 'OEBPS'), 'a<br/>b');
	assert.equal(shown(null, 'OEBPS'), null);
	console.log('ok: translation save round trip (display -> browser HTML -> stored)');
} finally {
	await server.close();
}
