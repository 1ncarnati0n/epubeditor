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
	await appendFile(process.env.MOCK_CODEX_ARGV, JSON.stringify(args) + '\\n');
	const prompt = args.at(-1);
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
	if (blockIds) {
		const ids = JSON.parse('[' + blockIds + ']');
		const page = await call('get_blocks', { chapterId, blockIds: ids }, 1);
		await call('submit_translations', {
			translations: page.blocks.map((block) => ({
				id: block.id,
				targetHtml: 'BLOCK ' + block.id
			})),
			overwriteReviewed: true
		}, 2);
	} else {
		const page = await call('get_blocks', { chapterId, status: 'untranslated', offset: 0, limit }, 1);
		const noProgress = page.blocks.some((block) => block.sourceHtml.includes('No progress'));
		if (page.blocks.length && !noProgress) {
			await call('submit_translations', {
				translations: page.blocks.map((block) => ({
					id: block.id,
					targetHtml: '번역 ' + block.id
				})),
				overwriteReviewed: false
			}, 2);
		}
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

function epub() {
	const files = {
		mimetype: strToU8('application/epub+zip'),
		'META-INF/container.xml': strToU8(
			'<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
		),
		'OEBPS/content.opf': strToU8(
			'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Codex Smoke</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>'
		),
		// 3 blocks so batchSize=2 forces two batches
		'OEBPS/one.xhtml': strToU8(
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>Hello world.</p><p>Second sentence.</p></body></html>'
		),
		'OEBPS/two.xhtml': strToU8(
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Two</h1><p>Stop this batch.</p></body></html>'
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
	assert.deepEqual(project.codex, { model: null, effort: null, batchSize: 20 });
	assert.equal(project.translationGuide, '');

	// --- 1. 실행 설정과 번역 지침이 실제 codex 호출에 반영되는가 ---
	response = await fetch(
		`${base}/api/settings`,
		Object.assign(
			json({
				codex: { model: MODEL, effort: EFFORT, batchSize: BATCH },
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
	assert.match(runs[0].at(-1), /limit=2/, '첫 batch는 설정한 크기');
	assert.match(runs[1].at(-1), /limit=1/, '남은 만큼만');
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

	// 원문이 "Hello world."인 블록으로 확인한다 (번역문과 원문이 눈에 띄게 다름)
	const probeBlock = (await chapterBlocks(ch1)).find((block) =>
		block.sourceHtml.includes('Hello world.')
	);
	assert.ok(probeBlock?.targetHtml, '검사용 블록이 번역돼 있어야 한다');

	const translatedOnly = await exportedFiles();
	const soloDoc = findDoc(translatedOnly.entries, probeBlock.targetHtml);
	assert.ok(soloDoc, '번역본에 번역문이 있어야 한다');
	assert.ok(!soloDoc.includes('epubeditor-src'), '번역만 모드에는 병기 span이 없다');
	assert.ok(!soloDoc.includes('Hello world.'), '번역만 모드에는 원문 영어가 없다');
	assert.match(translatedOnly.disposition, /book-ko\.epub/);

	await assertStatus(
		await fetch(`${base}/api/settings`, Object.assign(json({ bilingual: true }), { method: 'PATCH' })),
		200
	);
	const bilingual = await exportedFiles();
	const bothDoc = findDoc(bilingual.entries, probeBlock.targetHtml);
	assert.ok(
		bothDoc.includes(
			`${probeBlock.targetHtml}<span class="epubeditor-src">Hello world.</span>`
		),
		'원문은 번역문 바로 뒤, 같은 블록 안의 span이어야 한다'
	);
	const css = strFromU8(
		Object.entries(bilingual.entries).find(([name]) => name.endsWith('epubeditor.css'))[1]
	);
	assert.match(css, /\.epubeditor-src\{/, '병기 CSS 규칙이 EPUB에 들어가야 한다');
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
						id: `${ch1}:b1`,
						tag: 'p',
						sourceHtml: 'Hello world.', // 실제 원문과 같음 → stale 아님
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
	const kept = migratedBlocks.find((b) => b.id === `${ch1}:b1`);
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
		'CODEX SMOKE PASS — 실행 설정, 지침(Codex+MCP), 블록 번역, 큐, 작업파일, 스냅샷, 대역본, 종료 저장, 원문 분리, 드리프트 감지·해소, 원본 교체 거부, v1 마이그레이션, 작업 보호 안전벨트'
	);
	if (serverError.trim()) console.log('server stderr:', serverError.trim().slice(0, 500));
} finally {
	server?.kill('SIGTERM');
	await rm(temp, { recursive: true, force: true });
}
