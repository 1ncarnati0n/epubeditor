import { browser } from '$app/environment';
import type {
	Block,
	BlockStatus,
	BookSummary,
	Chapter,
	CodexSettings,
	CodexStatus,
	CodexTranslationScope,
	ProjectSummary,
	Snapshot,
	Typography,
	WorkSession
} from '$lib/types';

export type { BlockFilter } from '$lib/types';
type BlockFilter = import('$lib/types').BlockFilter;

export function matchesFilter(block: Block, filter: BlockFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'stale') return block.stale;
	return block.status === filter;
}

export const editor = $state({
	booting: true,
	project: null as ProjectSummary | null,
	chapterId: null as string | null,
	chapter: null as Chapter | null,
	/** blockId -> true, 잠깐 유지 — SSE로 막 도착한 번역의 하이라이트 */
	fresh: {} as Record<string, boolean>,
	sse: false,
	view: 'edit' as 'edit' | 'preview',
	settingsOpen: false,
	codexOpen: false,
	saveOpen: false,
	guideOpen: false,
	searchOpen: false,
	codex: null as CodexStatus | null,
	loadError: null as string | null,
	/** 지금 다루고 있는 블록 — 키보드 순회의 기준 */
	cursor: null as string | null,
	/** 어떤 블록만 볼지. machine = 검수해야 할 초벌 */
	filter: 'all' as BlockFilter,
	density: 'normal' as 'tight' | 'normal' | 'loose',
	navOpen: false,
	shelfOpen: false,
	books: [] as BookSummary[],
	/** 이번 Codex 작업에서 도착한 블록 누적 — JobBar의 +N */
	arrived: 0,
	save: { dirty: false, savedAt: null as number | null },
	snapshots: [] as Snapshot[],
	/** 미리보기 iframe 강제 리로드 카운터 (조판 변경·번역 도착 시 증가) */
	previewRev: 0,
	/** 리로드 뒤 복원할 미리보기 스크롤 위치 */
	previewScroll: 0
});

/** 화면 밀도는 책 데이터가 아니라 이 브라우저의 취향이므로 localStorage에 둔다 */
export type Density = 'tight' | 'normal' | 'loose';

export function setDensity(density: Density): void {
	if (!browser) return;
	editor.density = density;
	document.documentElement.dataset.density = density;
	localStorage.setItem('epubeditor:density', density);
}

export async function boot(): Promise<void> {
	if (!browser) return;
	setDensity((localStorage.getItem('epubeditor:density') as Density) || 'normal');
	await refreshProject();
	void refreshCodex();
	void refreshSaveState();
	void refreshBooks();
	await restoreSession(); // 덮던 자리에서 이어간다
	editor.booting = false;
	connect();
}

async function refreshProject(): Promise<void> {
	const res = await fetch('/api/project');
	if (res.ok) {
		editor.project = await res.json();
		editor.loadError = null;
	} else {
		editor.project = null;
		// 원본이 바뀌어 로드가 거부된 경우 이유를 보여준다
		editor.loadError = (await res.json().catch(() => null))?.message ?? null;
	}
}

/** 원문이 바뀐 번역 정리 — blockId 없으면 전부 */
export async function resolveStale(
	action: 'keep' | 'discard',
	blockId?: string
): Promise<string | null> {
	const res = await fetch('/api/stale', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, blockId })
	});
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '정리에 실패했습니다';
	await refreshProject();
	if (editor.chapterId) await openChapter(editor.chapterId);
	return null;
}

export async function refreshCodex(): Promise<void> {
	const res = await fetch('/api/codex');
	editor.codex = res.ok ? await res.json() : null;
}

export async function openChapter(id: string): Promise<void> {
	editor.chapterId = id;
	const res = await fetch(`/api/chapters/${id}`);
	editor.chapter = res.ok ? await res.json() : null;
	editor.cursor = visibleBlocks()[0]?.id ?? null;
	rememberSession({ chapterId: id, cursor: editor.cursor });
}

/* ---------- 커서: 키보드로 훑는 기준점 ---------- */

/** 지금 필터에서 실제로 화면에 있는 블록들 */
export function visibleBlocks(): Block[] {
	return (editor.chapter?.blocks ?? []).filter((b) => matchesFilter(b, editor.filter));
}

export function setCursor(blockId: string | null): void {
	editor.cursor = blockId;
	rememberSession({ cursor: blockId });
	if (blockId) scrollToBlock(blockId);
}

function scrollToBlock(blockId: string): void {
	if (!browser) return;
	// DOM이 갱신된 뒤에 찾는다
	requestAnimationFrame(() => {
		document
			.querySelector(`[data-block="${CSS.escape(blockId)}"]`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});
}

export function moveCursor(delta: 1 | -1): void {
	const rows = visibleBlocks();
	if (!rows.length) return;
	const at = rows.findIndex((b) => b.id === editor.cursor);
	const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
	setCursor(rows[next].id);
}

/**
 * 다음 초벌(검수 대기)로. 현재 챕터에 없으면 초벌이 남은 다음 챕터를 열어서 이어간다 —
 * 챕터 경계에서 손이 멈추지 않는 것이 이 기능의 요점이다.
 */
export async function jumpToNextUnreviewed(): Promise<boolean> {
	const blocks = editor.chapter?.blocks ?? [];
	const at = blocks.findIndex((b) => b.id === editor.cursor);
	const ahead = blocks.slice(at + 1).find((b) => b.status === 'machine');
	if (ahead) {
		setCursor(ahead.id);
		return true;
	}
	const chapters = editor.project?.chapters ?? [];
	const here = chapters.findIndex((c) => c.id === editor.chapterId);
	const nextChapter =
		chapters.slice(here + 1).find((c) => c.machine > 0) ?? chapters.find((c) => c.machine > 0);
	if (!nextChapter) return false;
	await openChapter(nextChapter.id);
	const first = (editor.chapter?.blocks ?? []).find((b) => b.status === 'machine');
	setCursor(first?.id ?? null);
	return !!first;
}

/** returns an error message, or null on success */
export async function uploadEpub(file: File): Promise<string | null> {
	const form = new FormData();
	form.set('file', file);
	const res = await fetch('/api/upload', { method: 'POST', body: form });
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		return body?.message ?? '업로드에 실패했습니다';
	}
	editor.project = await res.json();
	editor.chapter = null;
	editor.chapterId = null;
	const first = editor.project?.chapters.find((c) => c.total > 0);
	if (first) await openChapter(first.id);
	return null;
}

export async function saveBlock(
	blockId: string,
	patch: { targetHtml?: string; status?: BlockStatus }
): Promise<void> {
	const chapterId = blockId.split(':')[0];
	const res = await fetch(`/api/chapters/${chapterId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ blockId, ...patch })
	});
	if (res.ok) {
		mergeBlocks(chapterId, [await res.json()], false);
		editor.save.dirty = true;
		void refreshProject();
	}
}

function mergeBlocks(chapterId: string, blocks: Block[], markFresh: boolean): void {
	if (editor.chapterId !== chapterId || !editor.chapter) return;
	for (const incoming of blocks) {
		const i = editor.chapter.blocks.findIndex((b) => b.id === incoming.id);
		if (i < 0) continue;
		editor.chapter.blocks[i] = incoming;
		if (markFresh) {
			// 배치가 20개씩 들어오고 다음 배치까지 30초쯤 조용하다 — 짧으면 놓친다
			editor.fresh[incoming.id] = true;
			setTimeout(() => delete editor.fresh[incoming.id], 4000);
		}
	}
}

export async function saveTypography(patch: Partial<Typography>): Promise<void> {
	if (!editor.project) return;
	Object.assign(editor.project.typography, patch);
	editor.previewRev++;
	editor.save.dirty = true;
	await fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
}

export async function saveCodexSettings(patch: Partial<CodexSettings>): Promise<void> {
	if (!editor.project) return;
	Object.assign(editor.project.codex, patch);
	editor.save.dirty = true;
	await fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ codex: patch })
	});
}

export async function saveTranslationGuide(translationGuide: string): Promise<void> {
	if (!editor.project) return;
	editor.project.translationGuide = translationGuide;
	editor.save.dirty = true;
	await fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ translationGuide })
	});
}

/* ---------- 저장 ---------- */

/**
 * 파일 내려받기. `<a download>`는 서버가 409/404를 주면 그 JSON 페이지로 이동해버려서
 * (내보내기 차단 메시지가 그렇게 샜다) 직접 받아 blob으로 저장하고 오류는 문자열로 돌려준다.
 * 성공하면 null.
 */
export async function download(url: string): Promise<string | null> {
	const res = await fetch(url);
	if (!res.ok) {
		return (await res.json().catch(() => null))?.message ?? '내려받지 못했습니다';
	}
	const disposition = res.headers.get('content-disposition') ?? '';
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
	const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
	const name = encoded ? decodeURIComponent(encoded) : (plain ?? 'download');

	const href = URL.createObjectURL(await res.blob());
	const a = document.createElement('a');
	a.href = href;
	a.download = name;
	a.click();
	URL.revokeObjectURL(href);
	return null;
}

async function refreshSaveState(): Promise<void> {
	const res = await fetch('/api/save');
	if (res.ok) editor.save = await res.json();
}

export async function saveNow(): Promise<void> {
	const res = await fetch('/api/save', { method: 'POST' });
	if (res.ok) editor.save = await res.json();
}

export async function refreshSnapshots(): Promise<void> {
	const res = await fetch('/api/snapshots');
	editor.snapshots = res.ok ? await res.json() : [];
}

/** returns an error message, or null on success */
async function snapshotRequest(url: string, body?: unknown): Promise<string | null> {
	const res = await fetch(url, {
		method: 'POST',
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '요청에 실패했습니다';
	await refreshSnapshots();
	return null;
}

export function createSnapshot(label: string): Promise<string | null> {
	return snapshotRequest('/api/snapshots', { label });
}

export async function restoreSnapshot(id: string): Promise<string | null> {
	const failure = await snapshotRequest(`/api/snapshots/${id}/restore`);
	if (!failure) await reloadEverything();
	return failure;
}

export async function importWorkFile(file: File): Promise<string | null> {
	let payload: unknown;
	try {
		payload = JSON.parse(await file.text());
	} catch {
		return '작업파일을 읽지 못했습니다';
	}
	const res = await fetch('/api/project/file', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '작업파일을 적용하지 못했습니다';
	await refreshSnapshots();
	await reloadEverything();
	return null;
}

/* ---------- 책장: 여러 권 오가기 ---------- */

export async function refreshBooks(): Promise<void> {
	const res = await fetch('/api/books');
	editor.books = res.ok ? await res.json() : [];
}

/** returns an error message, or null on success */
export async function switchBook(bookId: string): Promise<string | null> {
	const res = await fetch(`/api/books/${bookId}`, { method: 'POST' });
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '책을 열지 못했습니다';
	editor.project = await res.json();
	editor.shelfOpen = false;
	await restoreSession();
	void refreshBooks();
	return null;
}

export async function removeBook(bookId: string): Promise<string | null> {
	const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '지우지 못했습니다';
	await refreshBooks();
	return null;
}

/** 저장해둔 자리(챕터·커서·필터)로 되돌린다 — 없으면 첫 작업 챕터부터 */
async function restoreSession(): Promise<void> {
	const s = editor.project?.session;
	editor.filter = s?.filter ?? 'all';
	const target =
		(s?.chapterId && editor.project?.chapters.find((c) => c.id === s.chapterId)?.id) ||
		editor.project?.chapters.find((c) => c.total > 0)?.id;
	if (!target) {
		editor.chapter = null;
		editor.chapterId = null;
		return;
	}
	await openChapter(target);
	if (s?.cursor && editor.chapter?.blocks.some((b) => b.id === s.cursor)) setCursor(s.cursor);
}

/** 지금 자리를 책에 기록한다 (debounce 저장 경로를 그대로 탄다) */
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
function rememberSession(patch: Partial<WorkSession>): void {
	if (!editor.project) return;
	Object.assign(editor.project.session, patch);
	if (sessionTimer) clearTimeout(sessionTimer);
	sessionTimer = setTimeout(() => {
		void fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ session: patch })
		});
	}, 600);
}

/* ---------- 검색·치환 ---------- */

export interface SearchHit {
	chapterId: string;
	chapterTitle: string | null;
	blockId: string;
	text: string;
}

export async function search(
	q: string,
	where: 'source' | 'target'
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
	const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&in=${where}`);
	return res.ok ? await res.json() : { hits: [], truncated: false };
}

/** dryRun이면 몇 개가 바뀔지만 센다 */
export async function replaceAll(
	from: string,
	to: string,
	dryRun: boolean
): Promise<{ matched: number; applied: number } | string> {
	const res = await fetch('/api/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ from, to, dryRun })
	});
	if (!res.ok) return (await res.json().catch(() => null))?.message ?? '치환에 실패했습니다';
	const result = await res.json();
	if (!dryRun && result.applied) {
		await refreshProject();
		if (editor.chapterId) await openChapter(editor.chapterId);
	}
	return result;
}

/** 검색 결과를 눌렀을 때 — 해당 챕터를 열고 그 블록으로 커서를 옮긴다 */
export async function goToBlock(chapterId: string, blockId: string): Promise<void> {
	if (editor.chapterId !== chapterId) await openChapter(chapterId);
	if (!matchesFilter(editor.chapter?.blocks.find((b) => b.id === blockId) ?? ({} as Block), editor.filter)) {
		editor.filter = 'all';
	}
	setCursor(blockId);
}

async function reloadEverything(): Promise<void> {
	await refreshProject();
	if (editor.chapterId) await openChapter(editor.chapterId);
	editor.previewRev++;
	void refreshSaveState();
}

async function codexRequest(method: 'POST' | 'DELETE', body?: unknown): Promise<string | null> {
	const res = await fetch('/api/codex', {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	const result = await res.json().catch(() => null);
	if (!res.ok) return result?.message ?? 'Codex 요청에 실패했습니다';
	if (method === 'DELETE') {
		if (editor.codex) editor.codex.job = result;
	} else if (result?.job) {
		editor.codex = result;
	} else if (editor.codex) {
		editor.codex.job = result;
	}
	return null;
}

export function connectCodex(): Promise<string | null> {
	return codexRequest('POST', { action: 'connect' });
}

export function startCodexTranslation(
	scope: CodexTranslationScope,
	chapterId?: string
): Promise<string | null> {
	return codexRequest('POST', {
		action: 'start',
		scope,
		chapterId: scope === 'chapter' ? (chapterId ?? editor.chapterId) : undefined
	});
}

/** 블록 한 개만 Codex에 보낸다 — 실행 중이면 큐에 쌓인다 */
export function translateBlock(blockId: string): Promise<string | null> {
	return codexRequest('POST', { action: 'start', scope: 'block', blockId });
}

export function stopCodexTranslation(): Promise<string | null> {
	return codexRequest('DELETE');
}

/**
 * 배치가 연달아 들어올 때 iframe을 계속 새로 그리지 않도록 모아서 한 번.
 * 보고 있던 자리를 잃지 않게 스크롤 위치를 넘겨받아 복원한다(같은 오리진이라 읽을 수 있다).
 */
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function refreshPreview(): void {
	if (previewTimer) return;
	previewTimer = setTimeout(() => {
		previewTimer = null;
		const frame = document.querySelector('iframe.preview') as HTMLIFrameElement | null;
		editor.previewScroll = frame?.contentWindow?.scrollY ?? 0;
		editor.previewRev++;
	}, 1500);
}

function connect(): void {
	const es = new EventSource('/api/events');
	es.onopen = () => (editor.sse = true);
	es.onerror = () => (editor.sse = false); // EventSource가 알아서 재접속
	es.onmessage = (ev) => {
		const event = JSON.parse(ev.data);
		if (event.type === 'blocks') {
			mergeBlocks(event.chapterId, event.blocks, true);
			editor.save.dirty = true;
			if (editor.codex?.job.state === 'running') editor.arrived += event.blocks.length;
			// 미리보기를 켜둔 채 번역을 돌리면 화면이 얼어 보였다 — 도착하면 다시 그린다
			if (editor.view === 'preview' && event.chapterId === editor.chapterId) refreshPreview();
			void refreshProject();
		} else if (event.type === 'project') {
			void refreshProject().then(() => {
				if (editor.chapterId) void openChapter(editor.chapterId);
			});
		} else if (event.type === 'codex') {
			// 새 잡이 시작되면 '+N 도착' 카운터를 0으로 (안 그러면 잡을 넘어 누적된다)
			const was = editor.codex?.job.state;
			if (event.status.state === 'running' && was !== 'running') editor.arrived = 0;
			if (editor.codex) editor.codex.job = event.status;
			else void refreshCodex();
		} else if (event.type === 'saved') {
			editor.save = { dirty: false, savedAt: event.at };
		}
	};
}
