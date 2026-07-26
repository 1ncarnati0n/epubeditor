import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'epubeditor-codex-'));
const fakeCodex = path.join(temp, 'codex');
const stateFile = path.join(temp, 'mcp.json');
const argvLog = path.join(temp, 'argv.jsonl');
const runsLog = path.join(temp, 'runs.jsonl');

const MODEL = 'smoke-model';
const EFFORT = 'xhigh';
const BATCH = 2;
const GUIDE = '문체는 평어체';

const fakeSource = `#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const stateFile = process.env.MOCK_CODEX_STATE;
if (args[0] === '--version') {
	console.log('codex-cli mock');
	process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
	console.log('Logged in using mock');
	process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'add') {
	const url = args[args.indexOf('--url') + 1];
	await writeFile(stateFile, JSON.stringify({ url }));
	console.log("Added global MCP server 'epub-editor'.");
	process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'get') {
	try {
		const { url } = JSON.parse(await readFile(stateFile, 'utf8'));
		console.log(JSON.stringify({
			name: 'epub-editor',
			enabled: true,
			transport: { type: 'streamable_http', url }
		}));
		process.exit(0);
	} catch {
		process.exit(1);
	}
}
if (args[0] === 'exec') {
	const startedAt = Date.now();
	await appendFile(process.env.MOCK_CODEX_ARGV, JSON.stringify(args) + '\\n');
	const prompt = args.at(-1);
	// 실패 시나리오 주입: MOCK_FAIL 파일에 {mode, left}를 두면 그만큼 실패한다
	const failFile = process.env.MOCK_CODEX_FAIL;
	if (failFile) {
		try {
			const plan = JSON.parse(await readFile(failFile, 'utf8'));
			if (plan.left > 0) {
				plan.left -= 1;
				await writeFile(failFile, JSON.stringify(plan));
				if (plan.mode === 'permanent') {
					console.error('stream error: You are not logged in. Run codex login.');
				} else {
					console.error('failed to connect to websocket: HTTP error: 503 Service Unavailable, url: wss://chatgpt.com/backend-api/codex/responses');
					console.error('auth error code: biscuit_baker_service_me_circuit_open');
				}
				process.exit(1);
			}
		} catch (e) {
			if (e.code !== 'ENOENT') throw e;
		}
	}
	const chapterId = prompt.match(/chapterId="([^"]+)"/)?.[1];
	const blockIds = prompt.match(/blockIds=\\[([^\\]]*)\\]/)?.[1];
	const limit = Number(prompt.match(/limit=(\\d+)/)?.[1] ?? 20);
	const config = args.find((arg) => arg.startsWith('mcp_servers.epub-editor.url='));
	const url = JSON.parse(config.slice(config.indexOf('=') + 1));
	const call = async (name, input, id) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id,
				method: 'tools/call',
				params: { name, arguments: input }
			})
		});
		const body = await response.json();
		return JSON.parse(body.result.content[0].text);
	};
	await new Promise((resolve) => setTimeout(resolve, 120));
	let submitted = [];
	// 배치와 단일 블록은 이제 둘 다 blockIds를 쓴다 — 프롬프트 종류로 구분한다
	const isSingle = prompt.includes('Translate one EPUB block');
	if (blockIds) {
		const ids = JSON.parse('[' + blockIds + ']');
		const page = await call('get_blocks', { chapterId, blockIds: ids }, 1);
		// 'No progress' 표식은 batch 경로의 무진행 시나리오 전용 — 블록 버튼은 항상 제출한다
		const noProgress =
			!isSingle && page.blocks.some((block) => block.sourceHtml.includes('No progress'));
		if (!noProgress) {
			submitted = page.blocks.map((b) => b.id);
			await call('submit_translations', {
				translations: page.blocks.map((block) => ({
					id: block.id,
					targetHtml: (isSingle ? 'BLOCK ' : '번역 ') + block.id
				})),
				overwriteReviewed: isSingle
			}, 2);
		}
	} else {
		const page = await call('get_blocks', { chapterId, status: 'untranslated', offset: 0, limit }, 1);
		const noProgress = page.blocks.some((block) => block.sourceHtml.includes('No progress'));
		if (page.blocks.length && !noProgress) {
			submitted = page.blocks.map((b) => b.id);
			await call('submit_translations', {
				translations: page.blocks.map((block) => ({
					id: block.id,
					targetHtml: '번역 ' + block.id
				})),
				overwriteReviewed: false
			}, 2);
		}
	}
	// 무엇을 언제부터 언제까지 처리했는지 — 겹침·동시성 검증용
	if (process.env.MOCK_CODEX_RUNS) {
		await appendFile(
			process.env.MOCK_CODEX_RUNS,
			JSON.stringify({ startedAt, endedAt: Date.now(), ids: submitted }) + '\\n'
		);
	}
	console.log(JSON.stringify({ type: 'thread.started', thread_id: 'mock' }));
	console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));
	process.exit(0);
}
process.exit(1);
`;

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(address.port));
		});
	});
}

function epub(title = 'Codex Smoke') {
	const files = {
		mimetype: strToU8('application/epub+zip'),
		'META-INF/container.xml': strToU8(
			'<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
		),
		'OEBPS/content.opf': strToU8(
			`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/><item id="eq" href="eq.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>`
		),
		'OEBPS/eq.png': strToU8('not-a-real-png'),
		// 3 blocks so batchSize=2 forces two batches.
		// 수식 이미지·MathML·다른 문서로 가는 링크·자기 문서를 가리키는 각주를 **기존 문단 안에**
		// 심는다 — 문단을 늘리면 블록 수가 바뀌어 다른 구간의 단언들이 깨진다.
		'OEBPS/one.xhtml': strToU8(
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1>' +
				'<p>Hello world <img src="eq.png" alt="eq" style="height:1.5em" onerror="boom()"/> and ' +
				'<math xmlns="http://www.w3.org/1998/Math/MathML"><mi mathvariant="italic" onmouseover="boom()">x</mi>' +
				'<mo>+</mo><mn>1</mn></math> <svg xmlns="http://www.w3.org/2000/svg" onload="boom()"/>.</p>' +
				'<p id="fn1">Second sentence, see <a href="two.xhtml#t2">Two</a> and ' +
				'<a href="one.xhtml#fn1">this very note</a>.</p></body></html>'
		),
		'OEBPS/two.xhtml': strToU8(
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Two</h1><p id="t2">Stop this batch.</p></body></html>'
		),
		'OEBPS/three.xhtml': strToU8(
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Three</h1><p>No progress batch.</p></body></html>'
		)
	};
	return zipSync(files);
}

/** okOnly=false면 실패 응답도 { status, body }로 돌려준다 (거부를 확인할 때) */
async function waitFor(url, test, timeout = 15_000, okOnly = true) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		try {
			const response = await fetch(url);
			const body = await response.json();
			if (response.ok) {
				if (test(body)) return body;
			} else if (!okOnly) {
				return { status: response.status, body };
			}
		} catch {
			// Server or job not ready yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`timeout waiting for ${url}`);
}

async function assertStatus(response, expected) {
	const detail = response.status === expected ? '' : await response.text();
	assert.equal(response.status, expected, detail);
}

let server;
try {
	await writeFile(fakeCodex, fakeSource);
	await chmod(fakeCodex, 0o755);
	await writeFile(stateFile, JSON.stringify({ url: 'http://127.0.0.1:1/mcp' }));
	await writeFile(argvLog, '');
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const json = (body) => ({
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: base },
		body: JSON.stringify(body)
	});
	const chapterBlocks = async (id) => (await (await fetch(`${base}/api/chapters/${id}`)).json()).blocks;
	// MCP 클라이언트(Claude Code 등)가 하는 것과 같은 호출
	const mcpCall = async (name, args) => {
		const response = await fetch(`${base}/mcp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args }
			})
		});
		const body = await response.json();
		assert.ok(!body.error, `${name}: ${JSON.stringify(body.error)}`);
		return JSON.parse(body.result.content[0].text);
	};
	const exportedFiles = async () => {
		const res = await fetch(`${base}/api/export`);
		await assertStatus(res, 200);
		return {
			entries: unzipSync(new Uint8Array(Buffer.from(await res.arrayBuffer()))),
			disposition: res.headers.get('content-disposition') ?? ''
		};
	};
	const execArgvs = async () =>
		(await readFile(argvLog, 'utf8'))
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));

	let serverError = '';
	const startServer = () => {
		const child = spawn(process.execPath, [path.join(root, 'build')], {
			cwd: root,
			env: {
				...process.env,
				HOST: '127.0.0.1',
				PORT: String(port),
				ORIGIN: base,
				BODY_SIZE_LIMIT: '20M',
				CODEX_BIN: fakeCodex,
				MOCK_CODEX_STATE: stateFile,
				MOCK_CODEX_ARGV: argvLog,
				MOCK_CODEX_FAIL: path.join(temp, 'fail.json'),
				MOCK_CODEX_RUNS: runsLog,
				CODEX_HOME: temp, // 모델 카탈로그 없음 → models: [] 폴백 경로도 함께 검증
				EPUBEDITOR_DATA_DIR: path.join(temp, 'data')
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		child.stderr.on('data', (chunk) => (serverError += String(chunk)));
		return child;
	};
	const stopServer = async () => {
		if (!server) return;
		const exited = new Promise((resolve) => server.once('exit', resolve));
		server.kill('SIGTERM');
		await exited;
		server = undefined;
	};
	server = startServer();

	// --- 연결: 낡은 주소를 현재 주소로 갱신 ---
	const stale = await waitFor(
		`${base}/api/codex`,
		(status) => status.cli === 'ready' && status.connection === 'stale'
	);
	assert.equal(stale.configuredUrl, 'http://127.0.0.1:1/mcp');
	assert.deepEqual(stale.models, [], 'CODEX_HOME에 캐시가 없으면 빈 목록');
	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'connect' })), 200);

	const form = new FormData();
	form.set('file', new Blob([epub()], { type: 'application/epub+zip' }), 'smoke.epub');
	let response = await fetch(`${base}/api/upload`, {
		method: 'POST',
		headers: { Origin: base },
		body: form
	});
	await assertStatus(response, 200);
	const project = await response.json();
	const [ch1, ch2, ch3] = project.chapters.map((chapter) => chapter.id);
	assert.deepEqual(project.codex, {
		model: null,
		effort: null,
		batchSize: 40,
		concurrency: 3,
		fastTier: true
	});
	// 새 책은 기본 지침을 들고 시작한다 (책마다 넣고 저장하는 수고를 없앴다)
	assert.ok(
		project.translationGuide.startsWith('- 문체는 평어체'),
		'새 책은 기본 번역 지침을 들고 시작해야 한다'
	);

	// --- 0b. 미리보기가 본문 링크를 살리는가 (번역이 문단을 덮기 전에 봐야 한다) ---
	{
		const html = await (await fetch(`${base}/preview/${ch1}`)).text();
		const leftover = html.match(/href="[^"]*\.x?html[^"]*"/)?.[0];
		assert.ok(!leftover, `문서명 링크가 남으면 404다: ${leftover}`);
		assert.ok(html.includes(`href="/preview/${ch2}#t2"`), '다른 문서 링크는 /preview/<id>#앵커 로');
		assert.ok(html.includes('href="#fn1"'), '자기 문서를 가리키던 각주는 앵커만 남아야 한다');
		await assertStatus(await fetch(`${base}/preview/${ch2}`), 200);
	}

	// --- 1. 실행 설정과 번역 지침이 실제 codex 호출에 반영되는가 ---
	response = await fetch(
		`${base}/api/settings`,
		Object.assign(
			json({
				codex: { model: MODEL, effort: EFFORT, batchSize: BATCH, concurrency: 1, fastTier: false },
				translationGuide: GUIDE
			}),
			{ method: 'PATCH' }
		)
	);
	await assertStatus(response, 200);

	// 지침이 MCP 클라이언트에게도 도달하는가 — Codex만 보는 게 아니어야 한다
	const withGuide = await mcpCall('get_blocks', { chapterId: ch1, status: 'all', limit: 1 });
	assert.equal(withGuide.translationGuide, GUIDE, 'get_blocks 응답에 지침이 실려야 한다');

	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'chapter', chapterId: ch1 })), 202);
	await waitFor(`${base}/api/codex`, (status) => status.job.state === 'completed');

	const runs = await execArgvs();
	assert.equal(runs.length, 2, `batchSize=${BATCH}이므로 3 block은 2번에 나눠 처리`);
	for (const argv of runs) {
		assert.ok(argv.includes('-m') && argv[argv.indexOf('-m') + 1] === MODEL, '-m <model>');
		assert.ok(argv.includes(`model_reasoning_effort="${EFFORT}"`), '-c model_reasoning_effort');
		assert.match(argv.at(-1), new RegExp(GUIDE), '번역 지침이 프롬프트에 포함');
	}
	// 일감은 blockIds로 못박아 넘긴다 — 워커가 여럿이어도 겹치지 않는 이유
	const idsOf = (argv) => JSON.parse(/blockIds=(\[[^\]]*\])/.exec(argv.at(-1))[1]);
	assert.equal(idsOf(runs[0]).length, BATCH, '첫 batch는 설정한 크기만큼 id를 받는다');
	assert.equal(idsOf(runs[1]).length, 1, '남은 만큼만');
	assert.equal(
		new Set([...idsOf(runs[0]), ...idsOf(runs[1])]).size,
		3,
		'두 batch의 id가 겹치지 않는다'
	);
	assert.ok((await chapterBlocks(ch1)).every((block) => block.status === 'machine'));

	// --- 2. 블록 버튼: 딱 한 block만, 검수됨도 덮어쓴다 ---
	const target = (await chapterBlocks(ch1))[1];
	await assertStatus(
		await fetch(
			`${base}/api/chapters/${ch1}`,
			Object.assign(json({ blockId: target.id, status: 'reviewed' }), { method: 'PATCH' })
		),
		200
	);
	const beforeBlock = await chapterBlocks(ch1);
	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'block', blockId: target.id })), 202);
	await waitFor(`${base}/api/codex`, (status) => status.job.state === 'completed');

	const afterBlock = await chapterBlocks(ch1);
	assert.equal(afterBlock[1].targetHtml, `BLOCK ${target.id}`, 'reviewed였어도 블록 버튼은 덮어쓴다');
	assert.equal(afterBlock[1].status, 'machine');
	const others = afterBlock.filter((_, i) => i !== 1);
	assert.deepEqual(
		others.map((block) => block.targetHtml),
		beforeBlock.filter((_, i) => i !== 1).map((block) => block.targetHtml),
		'다른 block은 건드리지 않는다'
	);

	// --- 2b. 수식이 번역을 통과해 살아남는가 (mock codex는 마크업을 안 보내므로 MCP로 직접) ---
	const MATH_HTML =
		'번역 <img src="eq.png" alt="eq" style="height:1.5em"/> 그리고 ' +
		'<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math>.';
	const eqBlock = `${ch1}:b1`;
	assert.equal(
		(await mcpCall('submit_translations', {
			translations: [{ id: eqBlock, targetHtml: MATH_HTML }],
			overwriteReviewed: true
		})).accepted,
		1
	);
	const eqAfter = (await chapterBlocks(ch1))[1];
	// 핵심: sanitize의 KEEP_SUBTREE / img 허용을 빼면 여기서 깨진다
	assert.ok(eqAfter.targetHtml.includes('<img'), '번역 속 수식 이미지가 살아남아야 한다');
	assert.ok(eqAfter.targetHtml.includes('<math'), '번역 속 MathML이 살아남아야 한다');
	assert.ok(eqAfter.targetHtml.includes('<mi>x</mi>'), 'MathML 자식까지 그대로여야 한다');
	assert.ok(eqAfter.targetHtml.includes('style="height:1.5em"'), '인라인 수식의 크기 지정이 남아야 한다');

	// 표시용은 /res/ 로 옮기고, 저장용은 원래 상대경로 그대로 (섞이면 내보낸 책이 깨진다)
	assert.ok(
		eqAfter.sourceHtml.includes('/res/OEBPS/eq.png'),
		'편집 화면에 뿌리는 원문의 이미지 경로는 /res/ 로 바뀌어야 한다'
	);
	/*
	 * math/svg 서브트리를 통째로 통과시키므로, 그 안의 실행 속성이 새면
	 * BlockRow의 {@html}로 앱 오리진에서 돈다 (<svg onload>는 <script> 없이도 실행된다).
	 * 원문은 남의 EPUB에서 온 것이라 이건 진짜 실행 경로다.
	 */
	assert.ok(
		!/on(error|load|mouseover)=/i.test(eqAfter.sourceHtml),
		`math/svg 안이라도 실행 속성은 지워야 한다: ${eqAfter.sourceHtml}`
	);
	assert.ok(eqAfter.sourceHtml.includes('mathvariant="italic"'), 'math의 표현 속성은 남아야 한다');
	assert.ok(eqAfter.sourceHtml.includes('<svg'), 'svg 자체는 남아야 한다');
	await fetch(`${base}/api/save`, { method: 'POST', headers: { Origin: base } }); // debounce를 앞당긴다
	const stored = JSON.parse(
		await readFile(path.join(temp, 'data', project.bookId, 'project.json'), 'utf8')
	);
	assert.ok(
		stored.translations[eqBlock].targetHtml.includes('src="eq.png"'),
		'디스크에 저장된 번역은 원래 상대경로여야 한다'
	);

	{
		const { entries: out } = await exportedFiles();
		const doc = strFromU8(out['OEBPS/one.xhtml']);
		assert.ok(doc.includes('<img') && doc.includes('<math'), '내보낸 EPUB에도 수식이 있어야 한다');
		assert.ok(doc.includes('src="eq.png"'), '내보낸 EPUB의 이미지 경로는 상대경로 그대로');
	}

	// 번역문 속 이미지도 재작성되는가 (주입→재작성 순서가 뒤집히면 여기서 깨진다)
	assert.ok(
		(await (await fetch(`${base}/preview/${ch1}`)).text()).includes('/res/OEBPS/eq.png'),
		'번역문 속 이미지도 /res/ 로 재작성돼야 한다'
	);

	// --- 3. 연타는 큐에 쌓여 전부 소진된다 (동시 발사 — 순차 await면 경합을 못 잡는다) ---
	const queueTargets = (await chapterBlocks(ch3)).map((block) => block.id);
	const fired = await Promise.all(
		queueTargets.map((blockId) =>
			fetch(`${base}/api/codex`, json({ action: 'start', scope: 'block', blockId }))
		)
	);
	for (const response of fired) await assertStatus(response, 202);
	const drained = await waitFor(`${base}/api/codex`, (status) => status.job.state === 'completed');
	assert.equal(drained.job.total, queueTargets.length, '동시에 눌러도 하나도 흘리지 않는다');
	assert.equal(drained.job.translated, queueTargets.length, '큐에 넣은 만큼 번역');
	assert.ok(
		(await chapterBlocks(ch3)).every((block) => block.targetHtml === `BLOCK ${block.id}`),
		'큐의 모든 block이 번역됨'
	);

	// --- 4. 작업파일 왕복 ---
	const workFile = await (await fetch(`${base}/api/project/file`)).json();
	const edited = (await chapterBlocks(ch1))[0].id;
	await assertStatus(
		await fetch(
			`${base}/api/chapters/${ch1}`,
			Object.assign(json({ blockId: edited, targetHtml: '손으로 고친 문장' }), { method: 'PATCH' })
		),
		200
	);
	assert.equal((await chapterBlocks(ch1))[0].targetHtml, '손으로 고친 문장');
	await assertStatus(await fetch(`${base}/api/project/file`, json(workFile)), 200);
	assert.equal((await chapterBlocks(ch1))[0].targetHtml, '번역 ' + edited, '작업파일이 되살아난다');
	await assertStatus(
		await fetch(`${base}/api/project/file`, json({ ...workFile, bookId: 'deadbeef0000' })),
		409
	);
	await assertStatus(await fetch(`${base}/api/project/file`, json({ nope: true })), 400);

	// --- 5. 스냅샷 되돌리기 ---
	await assertStatus(await fetch(`${base}/api/snapshots`, json({ label: '테스트 지점' })), 200);
	const snaps = await (await fetch(`${base}/api/snapshots`)).json();
	const snap = snaps.find((entry) => entry.label === '테스트 지점');
	assert.ok(snap, '수동 스냅샷이 목록에 있다');
	assert.ok(
		snaps.some((entry) => entry.label.includes('번역 전')),
		'chapter 번역 시작 전 자동 스냅샷도 남는다'
	);
	await assertStatus(
		await fetch(
			`${base}/api/chapters/${ch1}`,
			Object.assign(json({ blockId: edited, targetHtml: '되돌릴 문장' }), { method: 'PATCH' })
		),
		200
	);
	await assertStatus(await fetch(`${base}/api/snapshots/${snap.id}/restore`, json({})), 200);
	assert.equal((await chapterBlocks(ch1))[0].targetHtml, '번역 ' + edited, '스냅샷 시점으로 복원');

	// --- 5b. 검색·치환: 번역만 바꾸고 태그는 건드리지 않는다 ---
	const tagged = (await chapterBlocks(ch1))[2].id;
	await assertStatus(
		await fetch(
			`${base}/api/chapters/${ch1}`,
			Object.assign(json({ blockId: tagged, targetHtml: '<em>사과</em>와 사과주스' }), {
				method: 'PATCH'
			})
		),
		200
	);
	const found = await (await fetch(`${base}/api/search?q=${encodeURIComponent('사과')}&in=target`)).json();
	assert.ok(
		found.hits.some((h) => h.blockId === tagged),
		'번역에서 검색되어야 한다'
	);
	const noSource = await (await fetch(`${base}/api/search?q=${encodeURIComponent('사과')}&in=source`)).json();
	assert.equal(noSource.hits.length, 0, '영어 원문에는 그 말이 없다');

	const dry = await (
		await fetch(`${base}/api/search`, json({ from: '사과', to: '능금', dryRun: true }))
	).json();
	const wet = await (
		await fetch(`${base}/api/search`, json({ from: '사과', to: '능금', dryRun: false }))
	).json();
	assert.equal(dry.matched, wet.applied, 'dryRun이 센 개수 = 실제 바뀐 개수');
	const replaced = (await chapterBlocks(ch1)).find((b) => b.id === tagged);
	assert.equal(
		replaced.targetHtml,
		'<em>능금</em>와 능금주스',
		'텍스트만 바뀌고 <em> 태그는 그대로 남아야 한다'
	);
	assert.ok(
		(await (await fetch(`${base}/api/snapshots`)).json()).some((s) => s.label.includes('치환 전')),
		'치환 전 스냅샷이 남는다'
	);

	// --- 6. 대역본: 번역만 ↔ 원문 병기 ---
	const findDoc = (entries, needle) =>
		Object.entries(entries)
			.filter(([name]) => /\.x?html$/.test(name))
			.map(([, data]) => strFromU8(data))
			.find((text) => text.includes(needle));

	// 원문이 "Second sentence"인 블록으로 확인한다 (번역문과 원문이 눈에 띄게 다르고 마크업이 단순)
	const PROBE_SRC = 'Second sentence';
	const probeBlock = (await chapterBlocks(ch1)).find((block) =>
		block.sourceHtml.includes(PROBE_SRC)
	);
	assert.ok(probeBlock?.targetHtml, '검사용 블록이 번역돼 있어야 한다');

	const translatedOnly = await exportedFiles();
	const soloDoc = findDoc(translatedOnly.entries, probeBlock.targetHtml);
	assert.ok(soloDoc, '번역본에 번역문이 있어야 한다');
	assert.ok(!soloDoc.includes('epubeditor-src'), '번역만 모드에는 병기 span이 없다');
	assert.ok(!soloDoc.includes(PROBE_SRC), '번역만 모드에는 원문 영어가 없다');
	assert.match(translatedOnly.disposition, /book-ko\.epub/);

	await assertStatus(
		await fetch(`${base}/api/settings`, Object.assign(json({ bilingual: true }), { method: 'PATCH' })),
		200
	);
	const bilingual = await exportedFiles();
	const bothDoc = findDoc(bilingual.entries, probeBlock.targetHtml);
	assert.ok(
		bothDoc.includes(`${probeBlock.targetHtml}<span class="epubeditor-src">`) &&
			bothDoc.includes(PROBE_SRC),
		'원문은 번역문 바로 뒤, 같은 블록 안의 span이어야 한다'
	);
	const css = strFromU8(
		Object.entries(bilingual.entries).find(([name]) => name.endsWith('epubeditor.css'))[1]
	);
	const srcRule = css.match(/\.epubeditor-src\{([^}]*)\}/)?.[1];
	assert.ok(srcRule, '병기 CSS 규칙이 EPUB에 들어가야 한다');
	// 책이 `#id span{margin:0;font-size:100%;font:inherit}` 리셋을 실으면 클래스 하나(0,1,0)로는
	// 진다 (O'Reilly 책들이 그렇다 — 원문이 번역문과 같은 크기로 렌더됐다). 캐스케이드는 여기서
	// 못 재므로 리셋이 덮는 속성마다 !important가 붙어 있는지만 지킨다 — 지운 사람을 잡는 그물이다.
	for (const prop of ['font-size', 'line-height', 'margin-top']) {
		assert.match(
			srcRule,
			new RegExp(`${prop}:[^;]*!important`),
			`병기 원문 ${prop}은 책 CSS 리셋을 이겨야 한다`
		);
	}
	assert.match(bilingual.disposition, /book-bilingual\.epub/);

	await assertStatus(
		await fetch(`${base}/api/settings`, Object.assign(json({ bilingual: false }), { method: 'PATCH' })),
		200
	);

	// 지침을 비우면 get_blocks 응답에서 필드 자체가 사라진다
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(json({ translationGuide: '' }), { method: 'PATCH' })
		),
		200
	);
	const noGuide = await mcpCall('get_blocks', { chapterId: ch1, status: 'all', limit: 1 });
	assert.ok(!('translationGuide' in noGuide), '지침이 비면 필드를 보내지 않는다');

	// --- 6b. 여러 권: 목록·전환·세션·삭제 ---
	// 두 번째 책을 올린다 (다른 바이트 → 다른 bookId)
	const otherForm = new FormData();
	otherForm.set('file', new Blob([epub('Second Book')], { type: 'application/epub+zip' }), 'b.epub');
	response = await fetch(`${base}/api/upload`, {
		method: 'POST',
		headers: { Origin: base },
		body: otherForm
	});
	await assertStatus(response, 200);
	const second = await response.json();
	assert.notEqual(second.bookId, project.bookId, '다른 파일은 다른 책');

	let shelf = await (await fetch(`${base}/api/books`)).json();
	assert.equal(shelf.length, 2, '책장에 두 권');
	assert.ok(
		shelf.every((b) => b.title),
		'목록에 제목이 있다'
	);
	assert.equal(shelf.find((b) => b.bookId === second.bookId).active, true, '방금 올린 책이 활성');

	// 첫 책으로 돌아가면 번역이 그대로 있어야 한다 (섞이지 않음)
	const back = await (await fetch(`${base}/api/books/${project.bookId}`, json({}))).json();
	assert.equal(back.bookId, project.bookId);
	assert.ok(
		(await chapterBlocks(ch1)).some((b) => b.targetHtml),
		'전환해도 첫 책의 번역은 남아 있다'
	);
	const secondBlocks = await (await fetch(`${base}/api/chapters/s0`)).json();
	assert.ok(secondBlocks.blocks.length, '첫 책의 챕터를 다시 읽는다');

	// 세션: 챕터·커서·필터를 기록하고 갔다 오면 복원된다
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(
				json({
					session: { chapterId: ch3, cursor: `${ch3}:b1`, filter: 'machine', excluded: [ch2] }
				}),
				{ method: 'PATCH' }
			)
		),
		200
	);
	await fetch(`${base}/api/books/${second.bookId}`, json({}));
	const restored = await (await fetch(`${base}/api/books/${project.bookId}`, json({}))).json();
	assert.deepEqual(
		restored.session,
		{ chapterId: ch3, cursor: `${ch3}:b1`, filter: 'machine', excluded: [ch2] },
		'덮던 자리와 차례 체크가 책마다 따로 남는다'
	);

	// --- 6c. 일시 장애를 견디는가 (503 → 재시도 → 성공) ---
	// 갓 올린 두 번째 책은 전부 미번역이라 실패 시나리오를 깨끗하게 돌릴 수 있다
	await fetch(`${base}/api/books/${second.bookId}`, json({}));
	const failFile = path.join(temp, 'fail.json');
	const setFail = (mode, left) => writeFile(failFile, JSON.stringify({ mode, left }));
	const execCount = async () => (await execArgvs()).length;
	const [s0, s1] = second.chapters.map((c) => c.id);

	await setFail('transient', 2); // 처음 2번은 503으로 죽고 3번째에 성공해야 한다
	let calls = await execCount();
	await assertStatus(
		await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'chapter', chapterId: s0 })),
		202
	);
	const recovered = await waitFor(
		`${base}/api/codex`,
		(s) => s.job.state === 'completed' || s.job.state === 'failed',
		90_000
	);
	assert.equal(recovered.job.state, 'completed', '일시 장애는 재시도로 넘겨야 한다');
	assert.equal(recovered.job.failedChapters.length, 0, '재시도로 살아났으므로 건너뛴 chapter 없음');
	assert.ok(
		(await execCount()) - calls >= 3,
		'실패한 만큼 다시 불러야 한다 (재시도가 없으면 1회로 끝난다)'
	);
	assert.ok(
		(await (await fetch(`${base}/api/chapters/${s0}`)).json()).blocks.some((b) => b.targetHtml),
		'재시도 뒤 번역이 들어가 있다'
	);

	// --- 6d. 영구 오류는 재시도하지 않고, 그 chapter만 건너뛴다 ---
	await setFail('permanent', 99);
	calls = await execCount();
	await assertStatus(
		await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'chapter', chapterId: s1 })),
		202
	);
	const gaveUp = await waitFor(
		`${base}/api/codex`,
		(s) => s.job.state === 'completed' || s.job.state === 'failed',
		60_000
	);
	const permanentCalls = (await execCount()) - calls;
	assert.equal(permanentCalls, 1, `로그인 오류는 즉시 포기해야 한다 (실제 ${permanentCalls}회)`);
	assert.equal(gaveUp.job.failedChapters.length, 1, '건너뛴 chapter가 기록된다');
	assert.equal(gaveUp.job.failedChapters[0].id, s1);
	assert.match(gaveUp.job.failedChapters[0].reason, /codex login/, '읽을 수 있는 한 줄 요약');
	assert.ok(
		!gaveUp.job.failedChapters[0].reason.includes('wss://'),
		'원시 로그를 그대로 노출하지 않는다'
	);
	await rm(failFile, { force: true });

	// --- 6e. 병렬: 겹치지 않고 실제로 동시에 돈다 ---
	// 두 번째 책의 남은 미번역을 동시 3 · 배치 1로 돌린다 (배치를 잘게 쪼개 겹칠 기회를 최대화)
	await writeFile(runsLog, '');
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(json({ codex: { concurrency: 3, batchSize: 1, fastTier: true } }), {
				method: 'PATCH'
			})
		),
		200
	);
	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'book' })), 202);
	const parallel = await waitFor(
		`${base}/api/codex`,
		(s) => s.job.state === 'completed' || s.job.state === 'failed',
		90_000
	);
	assert.equal(parallel.job.state, 'completed');

	const execRuns = (await readFile(runsLog, 'utf8'))
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l));

	// (1) 같은 블록을 두 번 번역하지 않는다 — offset 기반이면 여기서 깨진다
	const all = execRuns.flatMap((r) => r.ids);
	assert.equal(new Set(all).size, all.length, `블록이 중복 제출됐다: ${all.length}건 중 ${new Set(all).size}개만 고유`);

	// (2) 실제로 겹쳐서 돈다
	const overlap = Math.max(
		...execRuns.map((r) => execRuns.filter((o) => o.startedAt < r.endedAt && o.endedAt > r.startedAt).length)
	);
	assert.ok(overlap >= 2, `동시에 돌지 않았다 (최대 겹침 ${overlap})`);

	// (3) service_tier가 전달된다 / 끄면 사라진다
	const recent = (await execArgvs()).slice(-execRuns.length);
	assert.ok(
		recent.every((a) => a.includes('service_tier="fast"')),
		'fastTier가 켜져 있으면 -c service_tier="fast"를 넘겨야 한다'
	);
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(json({ codex: { fastTier: false, concurrency: 1, batchSize: 40 } }), {
				method: 'PATCH'
			})
		),
		200
	);
	const beforeOff = (await execArgvs()).length;
	await assertStatus(
		await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'block', blockId: `${s0}:b0` })),
		202
	);
	await waitFor(`${base}/api/codex`, (s) => s.job.state !== 'running', 60_000);
	assert.ok(
		(await execArgvs()).slice(beforeOff).every((a) => !a.includes('service_tier="fast"')),
		'끄면 넘기지 않아야 한다'
	);

	// --- 6f. 차례에서 고른 chapter만 번역한다 ---
	// 세 번째 책은 전부 미번역이라 "안 고른 것이 번역됐는지"를 깨끗하게 볼 수 있다
	const thirdForm = new FormData();
	thirdForm.set('file', new Blob([epub('Third Book')], { type: 'application/epub+zip' }), 'c.epub');
	response = await fetch(`${base}/api/upload`, {
		method: 'POST',
		headers: { Origin: base },
		body: thirdForm
	});
	await assertStatus(response, 200);
	const third = await response.json();
	// 세 번째 chapter는 mock의 '무진행' 시나리오 전용이라 일부러 건드리지 않는다
	const [t0, t1] = third.chapters.map((c) => c.id);

	await assertStatus(
		await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'book', chapterIds: [t0] })),
		202
	);
	const partial = await waitFor(
		`${base}/api/codex`,
		(s) => s.job.state === 'completed' || s.job.state === 'failed',
		90_000
	);
	assert.equal(partial.job.state, 'completed');
	assert.ok(
		(await chapterBlocks(t0)).every((b) => b.targetHtml),
		`고른 chapter(${t0})는 전부 번역돼야 한다`
	);
	// 핵심: codex.ts의 필터를 지우면 여기서 깨진다 (이 단언이 기능 그 자체다 — 앞에 두지 말 것)
	assert.ok(
		(await chapterBlocks(t1)).every((b) => !b.targetHtml),
		`안 고른 chapter(${t1})는 한 블록도 번역되면 안 된다`
	);

	// 없는 id만 보내면 시작조차 하지 않는다 (조용히 책 전체로 번지면 안 된다)
	await assertStatus(
		await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'book', chapterIds: ['nope'] })),
		400
	);

	// 남은 chapter를 chapterIds 없이 돌리면 기존 '책 전체' 경로 그대로
	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'book' })), 202);
	await waitFor(`${base}/api/codex`, (s) => s.job.state !== 'running', 90_000);
	assert.ok(
		(await chapterBlocks(t1)).every((b) => b.targetHtml),
		'chapterIds를 안 보내면 전부 번역한다'
	);

	// 삭제: 활성 책은 거부, 비활성 책은 사라진다
	await fetch(`${base}/api/books/${project.bookId}`, json({}));
	await assertStatus(
		await fetch(`${base}/api/books/${third.bookId}`, { method: 'DELETE', headers: { Origin: base } }),
		200
	);
	await assertStatus(await fetch(`${base}/api/books/${project.bookId}`, { method: 'DELETE', headers: { Origin: base } }), 409);
	await assertStatus(await fetch(`${base}/api/books/${second.bookId}`, { method: 'DELETE', headers: { Origin: base } }), 200);
	shelf = await (await fetch(`${base}/api/books`)).json();
	assert.equal(shelf.length, 1, '지운 책은 책장에서 사라진다');

// --- 7. 기존 보호장치가 그대로인가 (취소·진행 없음·업로드 잠금) ---
	await assertStatus(await fetch(`${base}/api/codex`, json({ action: 'start', scope: 'chapter', chapterId: ch2 })), 202);
	const uploadWhileRunning = await fetch(`${base}/api/upload`, {
		method: 'POST',
		headers: { Origin: base },
		body: form
	});
	assert.equal(uploadWhileRunning.status, 409);
	await assertStatus(await fetch(`${base}/api/codex`, { method: 'DELETE', headers: { Origin: base } }), 200);
	await waitFor(`${base}/api/codex`, (status) => status.job.state === 'cancelled');

	// 저장 상태가 노출되는가
	const save = await (await fetch(`${base}/api/save`, { method: 'POST' })).json();
	assert.equal(save.dirty, false);
	assert.ok(save.savedAt > 0);

	assert.ok((await readFile(stateFile, 'utf8')).includes(`${base}/mcp`));

	// --- 7b. 책 정보(제목·저자)가 화면·디스크·내보낸 OPF까지 따라오는가 ---
	// 픽스처 OPF에는 dc:title만 있고 dc:creator는 없다 — 교체 경로와 추가 경로를 한 번에 태운다
	const NEW_TITLE = '한글 제목 & 기호';
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(json({ meta: { title: `  ${NEW_TITLE}  `, creator: '옮긴이' } }), {
				method: 'PATCH'
			})
		),
		200
	);
	let meta = await (await fetch(`${base}/api/project`)).json();
	assert.equal(meta.title, NEW_TITLE, '앞뒤 공백은 잘라서 저장한다');
	assert.equal(meta.creator, '옮긴이');

	await assertStatus(await fetch(`${base}/api/save`, { method: 'POST' }), 200);
	const metaOnDisk = JSON.parse(
		await readFile(path.join(temp, 'data', project.bookId, 'project.json'), 'utf8')
	);
	assert.equal(metaOnDisk.title, NEW_TITLE, '고친 제목이 디스크에 남는다');
	assert.equal(metaOnDisk.creator, '옮긴이');

	const renamed = await exportedFiles();
	let opf = strFromU8(renamed.entries['OEBPS/content.opf']);
	assert.match(opf, /<dc:title>한글 제목 &amp; 기호<\/dc:title>/, 'dc:title이 바뀌고 &가 이스케이프된다');
	assert.match(opf, /<dc:creator>옮긴이<\/dc:creator>/, '없던 dc:creator가 추가된다');
	assert.ok(
		decodeURIComponent(renamed.disposition).includes(NEW_TITLE),
		'내려받는 파일 이름도 새 제목을 쓴다'
	);

	// 저자를 비우면 빈 <dc:creator/>를 남기지 않고 항목째 지운다 (epubcheck가 빈 값을 건다)
	await assertStatus(
		await fetch(
			`${base}/api/settings`,
			Object.assign(json({ meta: { creator: '   ' } }), { method: 'PATCH' })
		),
		200
	);
	opf = strFromU8((await exportedFiles()).entries['OEBPS/content.opf']);
	assert.ok(!opf.includes('<dc:creator'), '저자를 비우면 dc:creator를 남기지 않는다');

	// 같은 EPUB을 다시 열어도 살아나는가 — join()이 저장된 값을 되얹지 않으면 여기서 깨진다
	response = await fetch(`${base}/api/upload`, {
		method: 'POST',
		headers: { Origin: base },
		body: form
	});
	await assertStatus(response, 200);
	meta = await response.json();
	assert.equal(meta.title, NEW_TITLE, '다시 열어도 고친 제목이 남는다');
	assert.equal(meta.creator, null, '비운 저자도 그대로 남는다');

	// --- 8. 서버를 끄면 마지막 편집이 디스크에 남는가 (debounce 타이머 + 종료 훅 합작) ---
	const doomed = (await chapterBlocks(ch1))[2].id;
	await assertStatus(
		await fetch(
			`${base}/api/chapters/${ch1}`,
			Object.assign(json({ blockId: doomed, targetHtml: '종료 직전 편집' }), { method: 'PATCH' })
		),
		200
	);
	await stopServer(); // debounce가 돌기 전에
	const projectFile = path.join(temp, 'data', project.bookId, 'project.json');
	const raw = await readFile(projectFile, 'utf8');
	const onDisk = JSON.parse(raw);
	assert.equal(
		onDisk.translations[doomed]?.targetHtml,
		'종료 직전 편집',
		'종료 직전 편집이 디스크에 남아야 한다'
	);

	// --- 9. 원문 분리: 저장 파일에 원문이 한 글자도 없다 ---
	assert.equal(onDisk.version, 2);
	assert.ok(!('chapters' in onDisk), 'v2에는 chapters(원문 사본)가 없다');
	assert.ok(!raw.includes('sourceHtml'), 'project.json에 sourceHtml이 없어야 한다');
	assert.ok(!raw.includes('Hello world.'), 'project.json에 원문 텍스트가 없어야 한다');
	assert.ok(onDisk.epubSha256?.length === 64, '원본 지문이 기록돼 있다');
	for (const t of Object.values(onDisk.translations)) {
		assert.ok(t.srcHash, '번역마다 출처 지문이 있다');
	}
	const snapRaw = await readFile(
		path.join(temp, 'data', project.bookId, 'snapshots', `${snap.id}.json`),
		'utf8'
	);
	assert.ok(!snapRaw.includes('sourceHtml'), '스냅샷에도 원문이 없다');

	// --- 10. 드리프트: 번역 뒤 원문이 바뀌면 그 블록만 stale, 내보내기 차단 ---
	const tampered = JSON.parse(raw);
	tampered.translations[doomed].srcHash = 'deadbeef'; // 원문이 바뀐 것과 같은 상황
	await writeFile(projectFile, JSON.stringify(tampered));
	server = startServer();
	const afterDrift = await waitFor(`${base}/api/project`, (p) => !!p.chapters);
	assert.equal(
		afterDrift.chapters.reduce((n, c) => n + c.stale, 0),
		1,
		'원문이 바뀐 블록 하나만 stale'
	);
	await assertStatus(await fetch(`${base}/api/export`), 409);
	const staleList = await (await fetch(`${base}/api/stale`)).json();
	assert.equal(staleList[0].blockId, doomed);

	// 나머지 번역은 멀쩡해야 한다
	const survivors = (await chapterBlocks(ch1)).filter((b) => b.id !== doomed && b.targetHtml);
	assert.ok(survivors.length > 0 && survivors.every((b) => !b.stale), '다른 블록은 영향 없음');

	// --- 11. 해소하면 다시 내보낼 수 있다 ---
	await assertStatus(await fetch(`${base}/api/stale`, json({ action: 'keep' })), 200);
	assert.equal(
		(await (await fetch(`${base}/api/project`)).json()).chapters.reduce((n, c) => n + c.stale, 0),
		0
	);
	await assertStatus(await fetch(`${base}/api/export`), 200);

	// --- 12. 원본 교체 감지: source.epub이 바뀌면 아예 열지 않는다 ---
	await stopServer();
	const sourceFile = path.join(temp, 'data', project.bookId, 'source.epub');
	const original = await readFile(sourceFile);
	await writeFile(sourceFile, Buffer.concat([original, Buffer.from('tampered')]));
	server = startServer();
	const refused = await waitFor(`${base}/api/project`, () => true, 15_000, false);
	assert.equal(refused.status, 409, '원본이 바뀌면 409');
	assert.match(refused.body.message, /원본 EPUB이/);
	await stopServer();
	await writeFile(sourceFile, original);

	// --- 13. v1 마이그레이션: 옛 형식이 그대로 살아난다 ---
	const v1 = {
		version: 1,
		bookId: project.bookId,
		title: project.title,
		language: 'en',
		creator: null,
		translationGuide: '옛 지침',
		typography: { bilingual: false },
		codex: { instructions: '옛 Codex 지침' },
		chapters: [
			{
				id: ch1,
				href: 'OEBPS/one.xhtml',
				title: 'One',
				blocks: [
					{
						id: `${ch1}:b0`,
						tag: 'h1',
						sourceHtml: 'One', // 실제 원문과 같음 → stale 아님
						targetHtml: 'v1에서 넘어온 번역',
						status: 'reviewed',
						updatedAt: 123
					},
					{
						id: `${ch1}:b2`,
						tag: 'p',
						sourceHtml: '옛날 원문이라 지금과 다름', // → stale
						targetHtml: '어긋난 번역',
						status: 'machine',
						updatedAt: 124
					}
				]
			}
		]
	};
	await writeFile(projectFile, JSON.stringify(v1));
	server = startServer();
	const migrated = await waitFor(`${base}/api/project`, (p) => !!p.chapters);
	assert.equal(migrated.translationGuide, '옛 지침', 'v1 지침이 옮겨온다');
	const migratedBlocks = await chapterBlocks(ch1);
	const kept = migratedBlocks.find((b) => b.id === `${ch1}:b0`);
	const drifted = migratedBlocks.find((b) => b.id === `${ch1}:b2`);
	assert.equal(kept.targetHtml, 'v1에서 넘어온 번역', '원문이 그대로면 번역이 살아난다');
	assert.equal(kept.stale, false);
	assert.equal(drifted.stale, true, '옛 원문과 다른 블록은 stale로 드러난다');
	await stopServer();
	assert.ok(
		!(await readFile(projectFile, 'utf8')).includes('sourceHtml'),
		'마이그레이션 뒤 파일은 v2다'
	);

	// --- 14. 안전벨트: 번역을 못 읽어도 디스크의 작업을 지우지 않는다 ---
	// (실제로 이 기능을 만드는 중간 상태에서 1,523블록이 이렇게 날아갔다)
	const good = await readFile(projectFile, 'utf8');
	const goodCount = Object.keys(JSON.parse(good).translations).length;
	assert.ok(goodCount > 0, '이 시점엔 번역이 있어야 한다');
	// 로더가 못 읽는 형식(미래 버전)을 심는다 → 번역 0으로 열리지만 파일은 그대로여야 한다
	await writeFile(projectFile, JSON.stringify({ ...JSON.parse(good), version: 99 }));
	server = startServer();
	const blank = await waitFor(`${base}/api/project`, (p) => !!p.chapters);
	assert.equal(
		blank.chapters.reduce((n, c) => n + c.machine + c.reviewed, 0),
		0,
		'못 읽는 형식이므로 메모리에는 번역이 없다'
	);
	await fetch(`${base}/api/save`, { method: 'POST', headers: { Origin: base } });
	await stopServer();
	assert.equal(
		Object.keys(JSON.parse(await readFile(projectFile, 'utf8')).translations).length,
		goodCount,
		'로드에 실패해도 디스크의 번역은 그대로 남아야 한다'
	);

	console.log(
		'CODEX SMOKE PASS — 실행 설정, 지침, 블록 번역, 큐, 검색·치환, 작업파일, 스냅샷, 대역본, 여러 권(목록·전환·세션·삭제), 고른 chapter만 번역, 책 정보, 종료 저장, 원문 분리, 드리프트 감지·해소, 원본 교체 거부, v1 마이그레이션, 작업 보호'
	);
	if (serverError.trim()) console.log('server stderr:', serverError.trim().slice(0, 500));
} finally {
	server?.kill('SIGTERM');
	await rm(temp, { recursive: true, force: true });
}
