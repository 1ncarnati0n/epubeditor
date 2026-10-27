import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { getDocument, OPS, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { defaultCodexSettings, type CodexSettings, type PdfJobStatus } from '$lib/types';
import { epubSha256 } from './epub/parse';
import { broadcast } from './events';
import { DATA_DIR, getProject, openEpub } from './store';
import { esc, inlineHtml, isMathPage, texToMathml, transcribePage, type MathBlock } from './pdf-math';

/*
 * 텍스트 PDF → 최소 EPUB. 결과는 openEpub()에 그대로 들어가므로 블록 추출·번역·내보내기는
 * EPUB과 같은 길을 탄다. PDF에는 "문단"이 없어 좌표로 추정한다:
 * 줄 = 같은 baseline의 조각들, 문단 = 줄 간격이 벌어지거나 들여쓴 곳, 제목 = 본문보다 큰 글자.
 *
 * 수식 페이지는 예외다 — 렌더링해서 Codex가 LaTeX로 받아 적은 블록으로 통째로 대체한다(pdf-math.ts).
 *
 * ponytail: 수식 없는 페이지의 다단 조판·표·선으로 그린 도표는 못 살린다(조각난 텍스트로 남거나 빠진다).
 *   그런 책을 만나면 "모든 페이지를 Codex로" 옵션을 검토한다.
 */

export class NoTextError extends Error {}

interface Line {
	y: number; // baseline (PDF 좌표, 위로 갈수록 큼)
	x: number;
	size: number;
	text: string;
}

type Item = { kind: 'line'; line: Line } | { kind: 'img'; y: number; file: string };

const MIN_IMG_PX = 32; // 이보다 작은 이미지(글머리표·장식)는 버린다

function mode(values: number[]): number {
	const counts = new Map<number, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

const round = (n: number) => Math.round(n * 2) / 2;

async function pageLines(page: PDFPageProxy): Promise<{ lines: Line[]; fonts: string[] }> {
	const content = await page.getTextContent();
	const pieces = content.items
		.filter((it) => 'str' in it && it.str.trim())
		.map((it) => {
			const t = (it as { transform: number[] }).transform;
			const { str, width } = it as { str: string; width: number };
			return { x: t[4], y: t[5], size: round(Math.hypot(t[2], t[3])), str, width };
		})
		.sort((a, b) => b.y - a.y || a.x - b.x);

	const lines: (Line & { end: number })[] = [];
	for (const p of pieces) {
		const line = lines.find((l) => Math.abs(l.y - p.y) < Math.max(l.size, p.size) * 0.5);
		if (!line) {
			lines.push({ y: p.y, x: p.x, size: p.size, text: p.str, end: p.x + p.width });
			continue;
		}
		// 조각 사이가 벌어져 있으면 띄어쓰기 — PDF는 공백을 글자로 안 주는 경우가 많다
		const gap = p.x - line.end > p.size * 0.15 && !/\s$/.test(line.text) && !/^\s/.test(p.str);
		line.text += (gap ? ' ' : '') + p.str;
		line.end = Math.max(line.end, p.x + p.width);
		line.size = Math.max(line.size, p.size);
		line.x = Math.min(line.x, p.x);
	}
	return {
		lines: lines
			.map(({ y, x, size, text }) => ({ y, x, size, text: text.replace(/\s+/g, ' ').trim() }))
			.sort((a, b) => b.y - a.y),
		fonts: Object.keys(content.styles)
	};
}

/** 폰트의 실제 이름(CMMI10 등) — getOperatorList() 뒤라야 commonObjs에 들어 있다 */
function fontNames(page: PDFPageProxy, ids: string[]): string[] {
	return ids.map((id) => {
		try {
			return String((page.commonObjs.get(id) as { name?: string })?.name ?? '');
		} catch {
			return '';
		}
	});
}

const RENDER_SCALE = 3; // 띠로 잘라 보낼 때 작은 첨자까지 읽히는 해상도 (pdf-math.ts strips)

async function renderPage(page: PDFPageProxy, file: string): Promise<void> {
	const viewport = page.getViewport({ scale: RENDER_SCALE });
	const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
	await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
	await writeFile(file, canvas.toBuffer('image/png'));
}

/** 렌더링한 페이지에서 그림 영역을 가로 전체로 잘라낸다 (선으로 그린 도표도 살아난다) */
async function cropFigure(pagePng: string, top: number, bottom: number): Promise<Uint8Array | null> {
	const img = await loadImage(await readFile(pagePng));
	const pad = 0.01;
	const y0 = Math.max(0, Math.floor((Math.min(top, bottom) - pad) * img.height));
	const y1 = Math.min(img.height, Math.ceil((Math.max(top, bottom) + pad) * img.height));
	if (y1 - y0 < MIN_IMG_PX) return null;
	const canvas = createCanvas(img.width, y1 - y0);
	canvas.getContext('2d').drawImage(img, 0, y0, img.width, y1 - y0, 0, 0, img.width, y1 - y0);
	return canvas.toBuffer('image/png');
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
			while (next < items.length) await work(items[next++]);
		})
	);
}

function encodePng(width: number, height: number, kind: number, data: Uint8Array): Uint8Array | null {
	// pdf.js ImageKind: 1 = 1bpp 흑백(1=흰색, 행은 바이트 정렬 — PNG와 같은 배치), 2 = RGB, 3 = RGBA
	const spec = { 1: { bits: 1, type: 0, row: Math.ceil(width / 8) }, 2: { bits: 8, type: 2, row: width * 3 }, 3: { bits: 8, type: 6, row: width * 4 } }[kind];
	if (!spec || data.length < spec.row * height) return null;
	const raw = new Uint8Array((spec.row + 1) * height);
	for (let y = 0; y < height; y++) raw.set(data.subarray(y * spec.row, (y + 1) * spec.row), y * (spec.row + 1) + 1);
	const chunk = (type: string, body: Uint8Array) => {
		const out = Buffer.alloc(12 + body.length);
		out.writeUInt32BE(body.length, 0);
		out.write(type, 4, 'latin1');
		out.set(body, 8);
		out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
		return out;
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([spec.bits, spec.type, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array())
	]);
}

type Img = { width: number; height: number; kind: number; data?: Uint8Array };

function getObj(page: PDFPageProxy, id: string): Promise<Img | null> {
	const store = id.startsWith('g_') ? page.commonObjs : page.objs;
	return new Promise((resolve) => {
		try {
			store.get(id, (img: Img) => resolve(img ?? null));
		} catch {
			resolve(null);
		}
	});
}

/** 페이지 속 이미지: CTM을 따라가며 그려지는 위치(윗변 y)를 구한다 */
async function pageImages(
	page: PDFPageProxy,
	pageNo: number,
	files: Zippable
): Promise<{ y: number; file: string }[]> {
	const ops = await page.getOperatorList();
	const out: { y: number; file: string }[] = [];
	const stack: number[][] = [];
	let ctm = [1, 0, 0, 1, 0, 0];
	const mul = (m: number[], n: number[]) => [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5]
	];
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		const args = ops.argsArray[i];
		if (fn === OPS.save) stack.push(ctm);
		else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
		else if (fn === OPS.transform) ctm = mul(ctm, args);
		else if (fn === OPS.paintFormXObjectBegin) {
			stack.push(ctm);
			if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0] as number[]));
		} else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
		else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
			const img = fn === OPS.paintImageXObject ? await getObj(page, args[0]) : (args[0] as Img);
			if (!img?.data || img.width < MIN_IMG_PX || img.height < MIN_IMG_PX) continue;
			const png = encodePng(img.width, img.height, img.kind, img.data);
			if (!png) continue;
			const file = `images/p${pageNo}-${out.length}.png`;
			files[`OEBPS/${file}`] = png;
			// 단위 정사각형이 CTM으로 그려진다 — 윗변은 y + max(0, d)
			out.push({ y: ctm[5] + Math.max(0, ctm[3]), file });
		}
	}
	return out;
}

async function chapterStarts(doc: PDFDocumentProxy): Promise<{ page: number; title: string }[]> {
	const outline = (await doc.getOutline().catch(() => null)) ?? [];
	const starts: { page: number; title: string }[] = [];
	for (const entry of outline) {
		try {
			const dest = typeof entry.dest === 'string' ? await doc.getDestination(entry.dest) : entry.dest;
			if (!dest) continue;
			const page = await doc.getPageIndex(dest[0]);
			if (!starts.some((s) => s.page === page)) starts.push({ page, title: entry.title });
		} catch {
			// 깨진 목차 항목은 건너뛴다
		}
	}
	starts.sort((a, b) => a.page - b.page);
	if (starts.length) {
		if (starts[0].page > 0) starts.unshift({ page: 0, title: '' });
		return starts;
	}
	// ponytail: 목차 없는 PDF는 10쪽씩 자른다 — 제목 글자로 챕터를 찾는 건 그런 책을 만나면
	return Array.from({ length: Math.ceil(doc.numPages / 10) }, (_, i) => ({ page: i * 10, title: '' }));
}

export interface PdfProgress {
	phase: 'read' | 'math';
	done: number;
	total: number;
	mathPages: number;
}

export interface PdfOptions {
	/** 수식 페이지를 Codex로 받아 적는다. 없으면 모든 페이지를 휴리스틱으로 */
	math?: { cacheDir: string; settings: CodexSettings };
	onProgress?: (p: PdfProgress) => void;
}

export interface PdfResult {
	epub: Uint8Array;
	/** 1부터 센 쪽 번호 */
	mathPages: number[];
	/** Codex가 끝내 실패해 휴리스틱으로 떨어진 쪽 */
	failed: { page: number; reason: string }[];
}

interface Page {
	lines: Line[];
	images: { y: number; file: string }[];
	text: string;
	math: boolean;
	png?: string;
	blocks?: MathBlock[];
}

export async function pdfToEpub(buf: Uint8Array, fileName = 'Untitled', opts: PdfOptions = {}): Promise<PdfResult> {
	// fontExtraProperties: 없으면 폰트 실제 이름(CMMI10…)이 안 보여 수식 페이지를 못 가린다
	const task = getDocument({ data: buf.slice(), verbosity: 0, fontExtraProperties: true });
	const doc = await task.promise;
	try {
		const files: Zippable = {};
		const pages: Page[] = [];
		if (opts.math) await mkdir(opts.math.cacheDir, { recursive: true });
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const { lines, fonts } = await pageLines(page);
			const images = await pageImages(page, n, files);
			const text = lines.map((l) => l.text).join('\n');
			const math = isMathPage(fontNames(page, fonts), text);
			const p: Page = { lines, images, text, math };
			if (math && opts.math) {
				p.png = path.join(opts.math.cacheDir, `p${String(n).padStart(4, '0')}.png`);
				if (!(await access(p.png).then(() => true, () => false))) await renderPage(page, p.png);
			}
			pages.push(p);
			page.cleanup();
			opts.onProgress?.({ phase: 'read', done: n, total: doc.numPages, mathPages: pages.filter((x) => x.math).length });
		}
		const all = pages.flatMap((p) => p.lines);
		if (all.length === 0) throw new NoTextError('텍스트가 없는 PDF(스캔본)는 지원하지 않습니다');

		const mathPages = pages.flatMap((p, i) => (p.math ? [i + 1] : []));
		const failed: { page: number; reason: string }[] = [];
		if (opts.math) {
			const { cacheDir, settings } = opts.math;
			let done = 0;
			const report = () =>
				opts.onProgress?.({ phase: 'math', done, total: mathPages.length, mathPages: mathPages.length });
			report();
			await pool(mathPages, settings.concurrency, async (n) => {
				const p = pages[n - 1];
				try {
					const cache = path.join(cacheDir, `p${String(n).padStart(4, '0')}.json`);
					p.blocks = await transcribePage(p.png!, p.text, cache, settings);
				} catch (error) {
					failed.push({ page: n, reason: error instanceof Error ? error.message : String(error) });
				}
				done++;
				report();
			});
			failed.sort((a, b) => a.page - b.page);
		}

		// 머리말·꼬리말: 여러 쪽에서 같은 자리에 (숫자만 다르게) 반복되는 줄. 쪽 번호만 있는 줄도 버린다.
		const key = (l: Line) => `${Math.round(l.y)}|${l.text.replace(/\d+/g, '#')}`;
		const seen = new Map<string, number>();
		for (const p of pages) for (const k of new Set(p.lines.map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
		const repeat = Math.max(3, pages.length * 0.3);
		for (const p of pages) p.lines = p.lines.filter((l) => (seen.get(key(l)) ?? 0) < repeat && !/^[\divxlc]+$/i.test(l.text));

		const body = mode(pages.flatMap((p) => p.lines.map((l) => l.size)));
		const gaps: number[] = [];
		for (const p of pages)
			for (let i = 1; i < p.lines.length; i++)
				if (p.lines[i].size === body && p.lines[i - 1].size === body) gaps.push(round(p.lines[i - 1].y - p.lines[i].y));
		const lineGap = mode(gaps) || body * 1.2;
		const tagOf = (size: number) => (size >= body * 1.3 ? 'h1' : size >= body * 1.15 ? 'h2' : 'p');

		const starts = await chapterStarts(doc);
		const chapters: { title: string; html: string[] }[] = [];
		// html은 이미 이스케이프된 상태 — 수식 페이지에서 온 MathML과 섞이기 때문이다
		let cur: { tag: string; html: string } | null = null;
		let chapter: { title: string; html: string[] } | null = null;
		const flush = () => {
			if (cur && chapter) chapter.html.push(`<${cur.tag}>${cur.html}</${cur.tag}>`);
			cur = null;
		};
		const ENDED = /[.!?:"”’)]$/;

		for (const [pageIndex, p] of pages.entries()) {
			const start = starts.find((s) => s.page === pageIndex);
			if (start) {
				flush();
				chapter = { title: start.title, html: [] };
				chapters.push(chapter);
			}
			if (p.blocks) {
				for (const [i, b] of p.blocks.entries()) {
					if (b.type === 'figure') {
						const png = await cropFigure(p.png!, b.top, b.bottom);
						if (!png) continue;
						const file = `images/p${pageIndex + 1}-fig${i}.png`;
						files[`OEBPS/${file}`] = png;
						flush();
						chapter!.html.push(`<div class="fig"><img src="${file}" alt=""/></div>`);
					} else if (b.type === 'eq') {
						flush();
						// div는 BLOCK_TAGS가 아니라 번역 블록이 되지 않는다 — 수식만 있는 줄은 번역할 게 없다
						chapter!.html.push(`<div class="eq">${texToMathml(b.text, true)}</div>`);
					} else {
						const html = inlineHtml(b.text.trim());
						const c = cur as { tag: string; html: string } | null;
						// 앞 쪽에서 끊긴 문단이 이 쪽 첫 블록으로 이어진다
						if (i === 0 && b.type === 'p' && c?.tag === 'p' && !ENDED.test(c.html)) c.html += ' ' + html;
						else {
							flush();
							cur = { tag: b.type, html };
						}
					}
				}
				continue;
			}
			const left = Math.min(...p.lines.filter((l) => l.size === body).map((l) => l.x), Infinity);
			const items: Item[] = [
				...p.lines.map((line): Item => ({ kind: 'line', line })),
				...p.images.map((im): Item => ({ kind: 'img', y: im.y, file: im.file }))
			].sort((a, b) => (b.kind === 'line' ? b.line.y : b.y) - (a.kind === 'line' ? a.line.y : a.y));

			let prev: Line | null = null;
			for (const item of items) {
				if (item.kind === 'img') {
					flush();
					chapter!.html.push(`<div class="fig"><img src="${item.file}" alt=""/></div>`);
					prev = null;
					continue;
				}
				const l = item.line;
				const tag = tagOf(l.size);
				const c = cur as { tag: string; html: string } | null;
				const sameBlock =
					c !== null &&
					c.tag === tag &&
					(prev
						? prev.y - l.y < (tag === 'p' ? lineGap * 1.4 : l.size * 1.8) &&
							!(tag === 'p' && l.x > left + body * 0.8)
						: // 쪽이 넘어가도 문장이 안 끝났으면 같은 문단
							tag === 'p' && !ENDED.test(c.html));
				if (!sameBlock) {
					flush();
					cur = { tag, html: esc(l.text) };
				} else if (/[a-z]-$/.test(c.html) && /^[a-z]/.test(l.text)) {
					c.html = c.html.slice(0, -1) + esc(l.text); // 줄 끝 하이픈 잇기
				} else {
					c.html += ' ' + esc(l.text);
				}
				prev = l;
			}
		}
		flush();

		const meta = (await doc.getMetadata().catch(() => null))?.info as Record<string, string> | undefined;
		const title = meta?.Title?.trim() || fileName.replace(/\.pdf$/i, '');
		const author = meta?.Author?.trim() || '';

		const ids = chapters.map((_, i) => `ch${String(i + 1).padStart(3, '0')}`);
		const xhtml = (t: string, inner: string) =>
			`<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(t)}</title><style>.fig{text-align:center;margin:1em 0}.fig img{max-width:100%}.eq{text-align:center;margin:0.8em 0;overflow-x:auto}</style></head><body>\n${inner}\n</body></html>`;
		chapters.forEach((c, i) => {
			files[`OEBPS/${ids[i]}.xhtml`] = strToU8(xhtml(c.title || title, c.html.join('\n')));
		});
		files['OEBPS/nav.xhtml'] = strToU8(
			xhtml(
				title,
				`<nav epub:type="toc"><ol>${chapters
					.map((c, i) => `<li><a href="${ids[i]}.xhtml">${esc(c.title || `${i + 1}`)}</a></li>`)
					.join('')}</ol></nav>`
			)
		);
		const images = Object.keys(files).filter((f) => f.endsWith('.png'));
		files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">pdf-${esc(title)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>\n` : ''}<dc:language>en</dc:language>
<meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${ids
	.map(
		(id, i) =>
			// EPUB3: MathML이 든 문서는 manifest에 밝혀야 한다
			`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"${chapters[i].html.some((h) => h.includes('<math')) ? ' properties="mathml"' : ''}/>`
	)
	.join('\n')}
${images.map((f, i) => `<item id="img${i}" href="${f.slice('OEBPS/'.length)}" media-type="image/png"/>`).join('\n')}
</manifest>
<spine>
${ids.map((id) => `<itemref idref="${id}"/>`).join('\n')}
</spine>
</package>`);
		files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

		// mimetype은 맨 앞·무압축이어야 한다. mtime 고정 = 같은 PDF → 같은 바이트 → 같은 bookId (하던 번역 이어받기)
		const { ['META-INF/container.xml']: container, ...rest } = files;
		const epub = zipSync(
			{ mimetype: [strToU8('application/epub+zip'), { level: 0 }], 'META-INF/container.xml': container, ...rest },
			{ mtime: new Date('2000-01-01T00:00:00Z') }
		);
		return { epub, mathPages, failed };
	} finally {
		await task.destroy();
	}
}

/*
 * 업로드 요청 안에서 끝낼 수 없다 — 수식 페이지마다 Codex를 부르면 한 권에 수십 분이다.
 * 백그라운드로 돌리고 진행은 SSE로, 끝나면 openEpub()으로 책을 연다.
 * 페이지별 결과는 data/pdf-cache/<pdf 해시>/에 남아 중단돼도 이어서 한다.
 */
let pdfJob: PdfJobStatus | null = null;

export function isPdfJobActive(): boolean {
	return pdfJob?.state === 'running';
}

export function startPdfJob(buf: Uint8Array, fileName: string): PdfJobStatus {
	const job: PdfJobStatus = {
		state: 'running',
		fileName,
		phase: 'read',
		done: 0,
		total: 0,
		mathPages: 0,
		failedPages: [],
		message: null
	};
	pdfJob = job;
	const publish = () => broadcast({ type: 'pdf', status: { ...job } });
	publish();
	void (async () => {
		try {
			const project = await getProject();
			const settings = { ...defaultCodexSettings(), ...project?.codex };
			const cacheDir = path.join(DATA_DIR, 'pdf-cache', epubSha256(buf).slice(0, 12));
			const result = await pdfToEpub(buf, fileName, {
				math: { cacheDir, settings },
				onProgress: (p) => {
					Object.assign(job, p);
					publish();
				}
			});
			job.failedPages = result.failed.map((f) => f.page);
			if (result.failed.length) console.error('pdf math pages failed:', result.failed);
			await openEpub(result.epub);
			job.state = 'done';
			job.message = result.failed.length
				? `수식 인식에 실패한 ${result.failed.length}쪽은 텍스트로만 변환했습니다 (${result.failed[0].reason}). 다시 올리면 그 쪽만 다시 시도합니다`
				: null;
		} catch (error) {
			job.state = 'failed';
			job.message =
				error instanceof NoTextError
					? error.message
					: `PDF 변환 실패: ${error instanceof Error ? error.message : String(error)}`;
		}
		publish();
	})();
	return { ...job };
}
