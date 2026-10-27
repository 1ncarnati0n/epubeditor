// PDF → EPUB 변환 점검: 챕터·제목·문단·그림이 살아남고 머리말·쪽 번호는 빠지는지, 같은 입력이면 같은 바이트인지 본다.
// 실행: node scripts/check-pdf.mjs <file.pdf> [기대 챕터 수] [기대 그림 수]
//   MATH=1 이면 수식 페이지를 Codex로 받아 적는다 (data/pdf-cache에 캐시 — 두 번째 실행은 Codex 호출 없음)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8 } from 'fflate';
import { createServer } from 'vite';

const [file, chapters, images] = process.argv.slice(2);
if (!file) throw new Error('usage: [MATH=1] node scripts/check-pdf.mjs <file.pdf> [chapters] [images]');

const server = await createServer({
	server: { middlewareMode: true, hmr: false, watch: null },
	appType: 'custom',
	logLevel: 'silent'
});

try {
	const { pdfToEpub } = await server.ssrLoadModule('/src/lib/server/pdf.ts');
	const { parseEpub, epubSha256 } = await server.ssrLoadModule('/src/lib/server/epub/parse.ts');
	const { defaultCodexSettings } = await server.ssrLoadModule('/src/lib/types.ts');
	const pdf = new Uint8Array(await readFile(file));
	const opts = process.env.MATH
		? {
				math: {
					cacheDir: path.resolve('data/pdf-cache', epubSha256(pdf).slice(0, 12)),
					settings: defaultCodexSettings()
				},
				onProgress: (p) => process.stdout.write(`\r${p.phase} ${p.done}/${p.total}  `)
			}
		: {};
	const first = await pdfToEpub(pdf, file, opts);
	const t0 = Date.now();
	const again = await pdfToEpub(pdf, file, opts);
	console.log(`\nsecond run ${Date.now() - t0}ms`);
	assert.deepEqual(again.epub, first.epub, '같은 PDF는 같은 EPUB 바이트여야 한다 (bookId 이어받기)');

	const { project, entries } = parseEpub(first.epub);
	const blocks = project.chapters.flatMap((c) => c.blocks);
	const pngs = Object.keys(entries).filter((f) => f.endsWith('.png'));
	for (const c of project.chapters) {
		console.log(`${c.id} "${c.title}" — ${c.blocks.length} blocks`);
		for (const b of c.blocks.slice(0, 4)) console.log(`  <${b.tag}> ${b.sourceHtml.replace(/<math[\s\S]*?<annotation[^>]*>([\s\S]*?)<\/annotation>[\s\S]*?<\/math>/g, '⟨$1⟩').slice(0, 110)}`);
	}
	console.log(`images: ${pngs.join(', ') || '-'}`);
	console.log(`math pages: ${first.mathPages.join(', ') || '-'}  failed: ${JSON.stringify(first.failed)}`);

	if (chapters) assert.equal(project.chapters.length, Number(chapters));
	if (images) assert.equal(pngs.length, Number(images));
	assert.ok(blocks.some((b) => b.tag === 'h1' || b.tag === 'h2'), '제목이 잡혀야 한다');
	assert.ok(!blocks.some((b) => /^\d+$/.test(b.sourceHtml.trim())), '쪽 번호가 남으면 안 된다');
	if (process.env.MATH) {
		const xhtml = Object.entries(entries)
			.filter(([f]) => f.endsWith('.xhtml'))
			.map(([, b]) => strFromU8(b))
			.join('\n');
		assert.ok(first.mathPages.length > 0, '수식 페이지를 찾아야 한다');
		assert.deepEqual(first.failed, [], '수식 인식 실패 없음');
		assert.match(xhtml, /<annotation encoding="application\/x-tex">/, 'LaTeX가 annotation에 남아야 한다');
		assert.match(xhtml, /<div class="eq"><math/, '별행 수식은 div.eq');
		assert.match(strFromU8(entries['OEBPS/content.opf']), /properties="mathml"/);
		assert.ok(blocks.some((b) => b.sourceHtml.includes('<math')), '인라인 수식이 든 문단이 번역 블록이어야 한다');
	}
	console.log(`ok: ${project.chapters.length} chapters, ${blocks.length} blocks, ${pngs.length} images`);
} finally {
	await server.close();
}
