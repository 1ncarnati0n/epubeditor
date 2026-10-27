import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import temml from 'temml';
import { z } from 'zod';
import type { CodexSettings } from '$lib/types';
import { codexBin, isTransient, summarize } from './codex';

/*
 * 수식 페이지는 텍스트층으로 복원할 수 없다: TeX 폰트(CMMI·CMSY·CMEX)는 유니코드 매핑이 틀리고,
 * 분수·첨자·근호는 글자 *위치*로만 존재하고, 큰 괄호·적분 기호는 선으로 그려진다.
 * 그래서 페이지를 그림으로 렌더링해 Codex(비전)에게 LaTeX로 받아 적게 하고, MathML로 바꿔 싣는다.
 * 원래 LaTeX는 <annotation encoding="application/x-tex">에 남는다.
 */

const MATH_FONT = /CM(MI|SY|EX|BSY)|MSBM|MSAM|EUFM|EUSM|rsfs|esint|MathJax|STIX.*Math|Cambria.?Math|LatinModernMath|XITSMath|Asana|Symbol/i;
const MATH_CHARS = /[∀-⋿⨀-⫿\u{1d400}-\u{1d7ff}]/gu;

export function isMathPage(fontNames: string[], text: string): boolean {
	return fontNames.some((n) => MATH_FONT.test(n)) || (text.match(MATH_CHARS)?.length ?? 0) >= 3;
}

export function esc(s: string): string {
	return s
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** LaTeX → MathML. 못 읽는 LaTeX는 원문 그대로 <code>로 남겨 사람이 고칠 수 있게 한다 */
export function texToMathml(tex: string, display: boolean): string {
	try {
		return temml.renderToString(tex, { displayMode: display, annotate: true, xml: true, throwOnError: true });
	} catch {
		return `<code class="tex">${esc(tex)}</code>`;
	}
}

/** 문단 텍스트: `\( … \)`·`\[ … \]`만 수식, 나머지는 글자 */
export function inlineHtml(text: string): string {
	return text
		.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/)
		.map((part, i) => (i % 2 ? texToMathml(part.slice(2, -2), part[1] === '[') : esc(part)))
		.join('');
}

const blockSchema = z.object({
	type: z.enum(['h1', 'h2', 'p', 'eq', 'figure']),
	text: z.string(),
	top: z.number(),
	bottom: z.number()
});
export type MathBlock = z.infer<typeof blockSchema>;
const pageSchema = z.object({ blocks: z.array(blockSchema) });

// codex --output-schema는 strict 모드라 모든 속성이 required + additionalProperties:false여야 한다
const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['blocks'],
	properties: {
		blocks: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['type', 'text', 'top', 'bottom'],
				properties: {
					type: { type: 'string', enum: ['h1', 'h2', 'p', 'eq', 'figure'] },
					text: { type: 'string' },
					top: { type: 'number' },
					bottom: { type: 'number' }
				}
			}
		}
	}
};

function prompt(hint: string): string {
	return `The first attached image is a whole book page. The following images are overlapping high-resolution
horizontal strips of the same page, top to bottom — read small symbols (minus signs, primes, sub/superscripts,
accents) from the strips; use the whole page only for layout and position.
Transcribe the page into structured blocks, in reading order.

Rules:
- Skip running headers, running footers and page numbers.
- Types: "h1"/"h2" headings, "p" paragraphs, "eq" display equations, "figure" diagrams/plots/images.
- In "p" and headings, write inline math in LaTeX wrapped in \\( ... \\). Keep the prose words exactly as printed.
- In "eq", put only the LaTeX (no delimiters). Multi-line displays: use \\begin{aligned} ... \\end{aligned}. Put an equation number like (1.2) as \\tag{1.2}.
- For "figure", text is "" — the figure is cropped from the page image. Include its caption as a separate "p".
- top/bottom: the block's vertical extent as a fraction of the page height (0 = top, 1 = bottom).
- Use standard LaTeX (amsmath/amssymb) only; never define macros.
- Copy every sign, subscript, superscript and prime exactly — check each equation against the image twice.
- A paragraph cut off at the page end stays as it is; do not finish the sentence.
- Do not use shell, files, web, or any other tools.

The PDF text layer of this page follows for exact spelling of words. Its math characters are often wrong or out of order; trust the image for math.
<text-layer>
${hint.slice(0, 6000)}
</text-layer>`;
}

function runCodex(args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let detail = '';
		// stdin을 닫지 않으면 codex exec가 "Reading additional input from stdin"에서 영영 기다린다
		const child = spawn(codexBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stdout.on('data', (c) => (detail = `${detail}${c}`.slice(-4000)));
		child.stderr.on('data', (c) => (detail = `${detail}${c}`.slice(-4000)));
		child.once('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.once('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(detail || `codex exited with ${code}`));
		});
	});
}

/*
 * 모델은 이미지를 짧은 변 768px 근처로 줄여서 본다 — 페이지 통째로는 근의 공식의 −b에서 마이너스가
 * 사라졌다(실측). 가로 폭 그대로, 높이는 폭의 절반인 띠로 겹쳐 잘라 함께 보내면 작은 기호가 살아난다.
 */
async function strips(pagePng: string, dir: string): Promise<string[]> {
	const img = await loadImage(await readFile(pagePng));
	const h = Math.round(img.width * 0.5);
	const step = Math.round(h * 0.8);
	const out: string[] = [];
	for (let y = 0; y < img.height; y += step) {
		const hh = Math.min(h, img.height - y);
		const canvas = createCanvas(img.width, hh);
		canvas.getContext('2d').drawImage(img, 0, y, img.width, hh, 0, 0, img.width, hh);
		const file = path.join(dir, `strip${out.length}.png`);
		await writeFile(file, canvas.toBuffer('image/png'));
		out.push(file);
		if (y + h >= img.height) break;
	}
	return out;
}

/**
 * 페이지 PNG 한 장 → 블록들. cacheFile이 있으면 Codex를 부르지 않는다
 * (중단 후 이어 하기 + 같은 PDF는 같은 EPUB 바이트 → 같은 bookId).
 */
export async function transcribePage(
	pngPath: string,
	hint: string,
	cacheFile: string,
	settings: CodexSettings
): Promise<MathBlock[]> {
	try {
		return pageSchema.parse(JSON.parse(await readFile(cacheFile, 'utf8'))).blocks;
	} catch {
		// 캐시 없음 — 아래에서 만든다
	}
	const dir = await mkdtemp(path.join(tmpdir(), 'epubeditor-pdf-'));
	try {
		const schemaPath = path.join(dir, 'schema.json');
		const outPath = path.join(dir, 'out.json');
		await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA));
		const args = [
			'exec',
			'--ephemeral',
			'--sandbox',
			'read-only',
			'--ignore-user-config',
			'--skip-git-repo-check',
			'-C',
			dir,
			...(settings.model ? ['-m', settings.model] : []),
			...(settings.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(settings.effort)}`] : []),
			...(settings.fastTier ? ['-c', 'service_tier="fast"'] : []),
			'-i',
			pngPath,
			...(await strips(pngPath, dir)).flatMap((f) => ['-i', f]),
			'--output-schema',
			schemaPath,
			'--output-last-message',
			outPath,
			prompt(hint)
		];
		for (let attempt = 1; ; attempt++) {
			try {
				await runCodex(args, 5 * 60_000);
				const blocks = pageSchema.parse(JSON.parse(await readFile(outPath, 'utf8'))).blocks;
				await writeFile(cacheFile, JSON.stringify({ blocks }));
				return blocks;
			} catch (error) {
				// 스키마 위반(잘린 JSON 등)도 한 번 더 해볼 가치가 있다
				const retry = isTransient(error) || error instanceof SyntaxError || error instanceof z.ZodError;
				if (!retry || attempt >= 5) throw new Error(summarize(error));
				await new Promise((r) => setTimeout(r, Math.min(60, 2 ** attempt) * 1000));
			}
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
