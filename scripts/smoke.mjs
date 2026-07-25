// 엔드투엔드 스모크 테스트: 업로드 → MCP 번역 제출 → 내보내기 검증
// 사용법: 서버 실행 상태에서  node scripts/smoke.mjs path/to/sample.epub
import { readFile } from 'node:fs/promises';
import assert from 'node:assert';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const epubPath = process.argv[2];
if (!epubPath) {
	console.error('usage: node scripts/smoke.mjs <sample.epub>');
	process.exit(1);
}

// 1. 업로드
const buf = await readFile(epubPath);
const form = new FormData();
form.set('file', new Blob([buf], { type: 'application/epub+zip' }), 'sample.epub');
// SvelteKit CSRF 보호(form POST의 Origin 검증) 통과용 — 브라우저는 자동 첨부
let res = await fetch(`${BASE}/api/upload`, {
	method: 'POST',
	body: form,
	headers: { origin: BASE }
});
assert.equal(res.status, 200, 'upload should succeed');
const project = await res.json();
const chapter = project.chapters.find((c) => c.total > 0);
assert.ok(chapter, 'should parse chapters with blocks');

// 2. MCP 루프: get_blocks → submit_translations
const mcp = async (name, args, id) => {
	const r = await fetch(`${BASE}/mcp`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream'
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method: 'tools/call',
			params: { name, arguments: args }
		})
	});
	const body = await r.json();
	assert.ok(!body.error, `${name} rpc error: ${JSON.stringify(body.error)}`);
	return JSON.parse(body.result.content[0].text);
};
const got = await mcp('get_blocks', { chapterId: chapter.id, limit: 1, status: 'all' }, 1);
assert.equal(got.returned, 1, 'get_blocks should return a block');
const marker = `스모크_${Date.now()} <em>인라인</em> 유지`;
const sub = await mcp(
	'submit_translations',
	{ translations: [{ id: got.blocks[0].id, targetHtml: marker }], overwriteReviewed: true },
	2
);
assert.equal(sub.accepted, 1, 'submit should be accepted');

// 3. 내보내기: OCF 규격 + 번역 포함 + 새니타이즈 왕복
res = await fetch(`${BASE}/api/export`);
assert.equal(res.status, 200, 'export should succeed');
const out = Buffer.from(await res.arrayBuffer());
assert.equal(out.readUInt32LE(0), 0x04034b50, 'zip magic');
assert.equal(out.toString('latin1', 30, 38), 'mimetype', 'mimetype must be first entry');
assert.equal(
	out.toString('latin1', 38, 58),
	'application/epub+zip',
	'mimetype must be stored uncompressed'
);
const entries = unzipSync(new Uint8Array(out));
const docs = Object.entries(entries).filter(([n]) => /\.x?html$/.test(n));
const hit = docs.some(([, data]) => strFromU8(data).includes(marker));
assert.ok(hit, 'exported epub must contain the submitted translation with inline tag');

console.log('SMOKE PASS —', project.title, `(${project.chapters.length} chapters)`);
