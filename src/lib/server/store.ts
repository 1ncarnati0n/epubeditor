import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type {
	Block,
	BlockStatus,
	Chapter,
	Project,
	Snapshot,
	StoredProject,
	StoredTranslation
} from '$lib/types';
import type { BookSummary, WorkSession } from '$lib/types';
import { defaultCodexSettings, defaultSession, defaultTypography } from '$lib/types';
import { broadcast } from './events';
import { epubSha256, parseEpub, sourceHash } from './epub/parse';

const STATUSES: BlockStatus[] = ['untranslated', 'machine', 'reviewed'];
const MAX_SNAPSHOTS = 20;

export class SourceMismatchError extends Error {}

/**
 * 옛 형식(v1: 원문 사본까지 통째로 담긴 project.json)을 v2로 옮긴다.
 * srcHash를 **그때 저장돼 있던 sourceHtml**로 계산하는 게 핵심 — 사람이 실제로 번역한
 * 원문이 그것이므로, 지금 원본과 다르면 로드 즉시 stale로 드러난다.
 */
function toStoredV2(raw: Record<string, unknown>, epubHash: string): StoredProject {
	const codex = { ...defaultCodexSettings(), ...(raw.codex as object) };
	// 옛 기본값 20은 속도 개선 전의 값 — 새 기본값으로 한 번 올린다
	if (codex.batchSize === 20) codex.batchSize = defaultCodexSettings().batchSize;
	const guide =
		(raw.translationGuide as string) ??
		((raw.codex as { instructions?: string })?.instructions || '');
	const base = {
		version: 2 as const,
		bookId: String(raw.bookId ?? ''),
		epubSha256: (raw.epubSha256 as string) || epubHash,
		title: String(raw.title ?? ''),
		creator: (raw.creator as string) ?? null,
		updatedAt: Number(raw.updatedAt) || 0,
		translationGuide: guide,
		typography: { ...defaultTypography(), ...(raw.typography as object) },
		codex,
		session: { ...defaultSession(), ...(raw.session as object) }
	};
	delete (base.codex as { instructions?: string }).instructions;

	if (raw.version === 2 && raw.translations) {
		return { ...base, translations: raw.translations as Record<string, StoredTranslation> };
	}
	const translations: Record<string, StoredTranslation> = {};
	for (const chapter of (raw.chapters as { blocks?: Block[] }[]) ?? []) {
		for (const block of chapter.blocks ?? []) {
			if (!block.targetHtml || block.status === 'untranslated') continue;
			translations[block.id] = {
				targetHtml: block.targetHtml,
				status: block.status,
				updatedAt: block.updatedAt || 0,
				srcHash: block.srcHash ?? sourceHash(block.sourceHtml ?? '')
			};
		}
	}
	return { ...base, translations };
}

/** 원본에서 파싱한 블록(정답)에 저장된 번역을 얹는다 */
function join(fresh: Project, stored: StoredProject): Project {
	// 사람이 고친 서지정보는 원본 OPF를 이긴다. 빈 제목은 파일명·OPF를 깨뜨리므로 폴백을 둔다.
	// creator는 ??가 아니라 그냥 대입 — "일부러 비웠다"와 "저장 안 됐다"를 구분해야 하는데,
	// toStoredV2가 없는 키를 null로 정규화하므로 실제 파일에는 늘 키가 있다.
	fresh.title = stored.title || fresh.title;
	fresh.creator = stored.creator;
	fresh.translationGuide = stored.translationGuide;
	fresh.typography = stored.typography;
	fresh.codex = stored.codex;
	fresh.session = stored.session;
	for (const chapter of fresh.chapters) {
		for (const block of chapter.blocks) {
			const t = stored.translations[block.id];
			if (!t) continue;
			block.targetHtml = t.targetHtml;
			block.status = t.status;
			block.updatedAt = t.updatedAt;
			block.srcHash = t.srcHash;
			block.stale = t.srcHash !== sourceHash(block.sourceHtml);
		}
	}
	return fresh;
}

function toStored(p: Project): StoredProject {
	const translations: Record<string, StoredTranslation> = {};
	for (const chapter of p.chapters) {
		for (const block of chapter.blocks) {
			if (block.targetHtml === null) continue;
			translations[block.id] = {
				targetHtml: block.targetHtml,
				status: block.status,
				updatedAt: block.updatedAt,
				srcHash: block.srcHash ?? sourceHash(block.sourceHtml)
			};
		}
	}
	return {
		version: 2,
		bookId: p.bookId,
		epubSha256: sourceSha,
		title: p.title,
		creator: p.creator,
		updatedAt: Date.now(),
		translationGuide: p.translationGuide,
		typography: p.typography,
		codex: p.codex,
		session: p.session,
		translations
	};
}

export function staleBlocks(p: Project): { chapterId: string; blockId: string }[] {
	return p.chapters.flatMap((c) =>
		c.blocks.filter((b) => b.stale).map((b) => ({ chapterId: c.id, blockId: b.id }))
	);
}

/**
 * 원문이 바뀐 번역을 정리한다.
 * keep = 지금 원문 기준으로 이 번역이 맞다고 확정 / discard = 번역을 버리고 미번역으로
 */
export async function resolveStale(
	action: 'keep' | 'discard',
	blockId?: string
): Promise<{ resolved: number; chapterIds: string[] }> {
	const p = await getProject();
	if (!p) return { resolved: 0, chapterIds: [] };
	const chapterIds = new Set<string>();
	let resolved = 0;
	for (const chapter of p.chapters) {
		for (const block of chapter.blocks) {
			if (!block.stale || (blockId && block.id !== blockId)) continue;
			if (action === 'keep') {
				block.srcHash = sourceHash(block.sourceHtml);
				block.stale = false;
			} else {
				setBlock(block, null, 'untranslated');
			}
			chapterIds.add(chapter.id);
			resolved++;
		}
	}
	if (resolved) await persistNow(); // setBlock이 이미 dirty로 만들었다
	return { resolved, chapterIds: [...chapterIds] };
}

export const DATA_DIR = path.resolve(process.env.EPUBEDITOR_DATA_DIR || 'data');

// ponytail: single active project held in module state — multi-project UI is a v2 concern
let project: Project | null = null;
let sourceEpub: Uint8Array | null = null;
let sourceSha = '';
let entriesCache: Record<string, Uint8Array> | null = null;
/** 원본이 저장된 지문과 다르면 열지 않는다 — 사용자에게 이유를 보여주기 위해 남긴다 */
let loadError: string | null = null;
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let lastSavedAt: number | null = null;

function dataDir(bookId: string) {
	return path.join(DATA_DIR, bookId);
}

/** atomic write — a half-written project.json would lose the whole book's work */
async function writeJson(file: string, data: unknown): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, JSON.stringify(data));
	await rename(tmp, file);
}

/** load the most recently touched project from disk (survives server restarts) */
async function hydrate(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	let best: { mtime: number; dir: string } | null = null;
	try {
		for (const d of await readdir(DATA_DIR)) {
			try {
				const s = await stat(path.join(DATA_DIR, d, 'project.json'));
				if (!best || s.mtimeMs > best.mtime) best = { mtime: s.mtimeMs, dir: d };
			} catch {
				// not a project dir
			}
		}
	} catch {
		return; // no data dir yet
	}
	if (!best) return;
	try {
		await adoptFrom(best.dir);
	} catch (e) {
		console.error('failed to restore project from disk:', e);
		loadError =
			e instanceof SourceMismatchError
				? e.message
				: '저장된 작업을 불러오지 못했습니다. EPUB을 다시 열어주세요.';
		project = null;
		sourceEpub = null;
	}
}

/**
 * 원본 EPUB이 진실이다: 블록은 항상 파일에서 다시 파싱하고, 디스크에서는 번역만 얹는다.
 * 그래서 project.json이 낡아도 블록 위치가 어긋날 수 없고, 남는 질문
 * "이 번역이 지금 이 자리의 문단의 것인가"는 srcHash가 답한다.
 */
async function adopt(buf: Uint8Array, raw: Record<string, unknown> | null): Promise<void> {
	const parsed = parseEpub(buf);
	const sha = epubSha256(buf);
	const stored = raw ? toStoredV2(raw, sha) : null;

	if (stored && stored.epubSha256 !== sha) {
		throw new SourceMismatchError(
			'원본 EPUB이 번역을 시작할 때와 다릅니다. data/ 안의 source.epub이 바뀌었는지 확인하세요.'
		);
	}
	sourceEpub = buf;
	sourceSha = sha;
	entriesCache = parsed.entries;
	if (stored && stored.bookId !== parsed.project.bookId) {
		// 같은 폴더에 다른 책의 작업이 들어 있다 — 조용히 덮어쓰지 않고 멈춘다
		throw new SourceMismatchError(
			`저장된 작업(${stored.bookId})이 이 EPUB(${parsed.project.bookId})의 것이 아닙니다.`
		);
	}
	project = stored ? join(parsed.project, stored) : parsed.project;
	loadError = null;
	hydrated = true;
	// 옛 형식(v1)을 읽었으면 한 번만 v2로 다시 써서 원문 사본을 디스크에서 지운다
	if (raw && raw.version !== 2) scheduleSave();
}

/**
 * 안전벨트: 번역이 하나도 없는 상태를, 번역이 들어 있던 파일 위에 쓰지 않는다.
 * 로드가 어떤 이유로든 실패해 빈 프로젝트가 만들어졌을 때 디스크의 작업까지 날리는 것을 막는다.
 * (실제로 이 코드를 만드는 도중 중간 상태의 서버가 1,523블록을 이렇게 지웠다.)
 */
async function wouldDestroyWork(file: string, next: StoredProject): Promise<boolean> {
	if (Object.keys(next.translations).length > 0) return false;
	try {
		const prior = JSON.parse(await readFile(file, 'utf8'));
		const priorCount = prior.translations
			? Object.keys(prior.translations).length
			: ((prior.chapters as { blocks?: Block[] }[]) ?? []).reduce(
					(n, c) => n + (c.blocks ?? []).filter((b) => b.targetHtml).length,
					0
				);
		return priorCount > 0;
	} catch {
		return false; // 읽을 파일이 없으면 지울 작업도 없다
	}
}

export function getLoadError(): string | null {
	return loadError;
}

/** data/<bookId>/ 하나를 활성 프로젝트로 올린다 (hydrate·책 전환 공용) */
async function adoptFrom(bookId: string): Promise<void> {
	await adopt(
		new Uint8Array(await readFile(path.join(DATA_DIR, bookId, 'source.epub'))),
		JSON.parse(await readFile(path.join(DATA_DIR, bookId, 'project.json'), 'utf8'))
	);
}

/* ---------- 책장: 여러 권을 오간다 ---------- */

export async function listBooks(): Promise<BookSummary[]> {
	await hydrate();
	let dirs: string[] = [];
	try {
		dirs = await readdir(DATA_DIR);
	} catch {
		return [];
	}
	const books: BookSummary[] = [];
	for (const bookId of dirs) {
		try {
			const dir = path.join(DATA_DIR, bookId);
			const stored = JSON.parse(await readFile(path.join(dir, 'project.json'), 'utf8'));
			const bytes = (await stat(path.join(dir, 'source.epub'))).size;
			// 활성 책은 메모리 상태가 최신이라 그쪽에서 센다 (저장 전 편집도 반영)
			const live = project?.bookId === bookId ? project : null;
			const counts = live
				? live.chapters.reduce(
						(a, c) => {
							for (const b of c.blocks) {
								a.total++;
								if (b.stale) a.stale++;
								if (b.status === 'machine') a.machine++;
								else if (b.status === 'reviewed') a.reviewed++;
							}
							return a;
						},
						{ total: 0, machine: 0, reviewed: 0, stale: 0 }
					)
				: countStored(stored);
			books.push({
				bookId,
				title: live?.title || stored.title || bookId,
				creator: live?.creator ?? stored.creator ?? null,
				...counts,
				updatedAt: stored.updatedAt || (await stat(path.join(dir, 'project.json'))).mtimeMs,
				bytes,
				active: project?.bookId === bookId
			});
		} catch {
			// project.json이나 source.epub이 없는 폴더는 책이 아니다
		}
	}
	return books.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 열지 않은 책은 총 block 수를 알 수 없다(원문을 파싱해야 하므로) — 번역 수만 센다 */
function countStored(stored: Record<string, unknown>): {
	total: number;
	machine: number;
	reviewed: number;
	stale: number;
} {
	const counts = { total: 0, machine: 0, reviewed: 0, stale: 0 };
	if (stored.translations) {
		for (const t of Object.values(stored.translations as Record<string, StoredTranslation>)) {
			if (t.status === 'machine') counts.machine++;
			else if (t.status === 'reviewed') counts.reviewed++;
		}
	} else {
		for (const c of (stored.chapters as { blocks?: Block[] }[]) ?? []) {
			for (const b of c.blocks ?? []) {
				counts.total++;
				if (b.status === 'machine') counts.machine++;
				else if (b.status === 'reviewed') counts.reviewed++;
			}
		}
	}
	return counts;
}

export async function openBook(bookId: string): Promise<Project> {
	if (!/^[0-9a-f]{12}$/.test(bookId)) throw new Error('알 수 없는 책입니다'); // 경로 조작 차단
	if (project?.bookId === bookId) return project;
	await persistNow(); // 지금 책의 debounce 대기분을 먼저 디스크에 확정
	await adoptFrom(bookId);
	await persistNow(); // updatedAt을 올려 '마지막 작업' 정렬과 hydrate 선택이 맞게
	return project as Project;
}

export async function deleteBook(bookId: string): Promise<void> {
	if (!/^[0-9a-f]{12}$/.test(bookId)) throw new Error('알 수 없는 책입니다');
	if (project?.bookId === bookId) throw new Error('지금 열려 있는 책은 지울 수 없습니다');
	await rm(path.join(DATA_DIR, bookId), { recursive: true, force: true });
}

export function setSession(patch: Partial<WorkSession>): void {
	if (!project) return;
	project.session = { ...project.session, ...patch };
	scheduleSave();
}

export async function openEpub(buf: Uint8Array): Promise<Project> {
	// 지금 책의 debounce 대기분을 먼저 확정한다 (openBook과 같은 이유).
	// 없으면 방금 고친 설정·서지정보가 디스크에 닿기 전에 adopt가 옛 파일을 되읽어 덮어쓴다.
	await persistNow();
	const bookId = epubSha256(buf).slice(0, 12);
	let prior: Record<string, unknown> | null = null;
	try {
		// 같은 바이트를 다시 올린 경우 -> 하던 번역을 이어받는다
		prior = JSON.parse(await readFile(path.join(dataDir(bookId), 'project.json'), 'utf8'));
	} catch {
		// fresh project
	}
	await adopt(buf, prior);
	await mkdir(dataDir(bookId), { recursive: true });
	await writeFile(path.join(dataDir(bookId), 'source.epub'), buf);
	await persistNow();
	return project as Project;
}

export async function getProject(): Promise<Project | null> {
	await hydrate();
	return project;
}

export async function getChapter(id: string): Promise<Chapter | null> {
	return (await getProject())?.chapters.find((c) => c.id === id) ?? null;
}

export async function findBlock(blockId: string): Promise<{ chapter: Chapter; block: Block } | null> {
	const chapter = await getChapter(blockId.split(':')[0]);
	const block = chapter?.blocks.find((b) => b.id === blockId);
	return chapter && block ? { chapter, block } : null;
}

/**
 * 번역이 들어오는 유일한 길목 — UI PATCH·MCP submit_translations·작업파일 임포트가 모두 여기를 지난다.
 * 그래서 여기서 출처 지문을 새기면 모든 경로에 자동으로 기록된다.
 */
export function setBlock(block: Block, targetHtml: string | null, status: BlockStatus) {
	block.targetHtml = targetHtml;
	block.status = status;
	block.updatedAt = Date.now();
	block.srcHash = targetHtml === null ? null : sourceHash(block.sourceHtml);
	block.stale = false;
	scheduleSave();
}

/** unzipped source epub entries (for preview resources + export) */
export async function getEntries(): Promise<Record<string, Uint8Array> | null> {
	await hydrate();
	if (!sourceEpub) return null;
	entriesCache ??= unzipSync(sourceEpub);
	return entriesCache;
}

export async function getSourceEpub(): Promise<Uint8Array | null> {
	await hydrate();
	return sourceEpub;
}

export function scheduleSave() {
	dirty = true;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => void persistNow().catch(console.error), 500);
}

export async function persistNow(): Promise<void> {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	if (!project) return;
	const file = path.join(dataDir(project.bookId), 'project.json');
	const next = toStored(project);
	if (await wouldDestroyWork(file, next)) {
		loadError = '저장된 번역을 덮어쓸 뻔해 저장을 중단했습니다. EPUB을 다시 열어주세요.';
		console.error(`refusing to overwrite ${file}: in-memory project has no translations`);
		return;
	}
	await writeJson(file, next);
	dirty = false;
	lastSavedAt = Date.now();
	broadcast({ type: 'saved', at: lastSavedAt });
}

export function saveState(): { dirty: boolean; savedAt: number | null } {
	return { dirty, savedAt: lastSavedAt };
}

/** last-chance flush from process 'exit', where only synchronous work runs */
export function persistSync(): void {
	if (!project || !dirty) return;
	const next = toStored(project);
	// 동기 경로에서도 같은 안전벨트 — 빈 번역은 절대 내보내지 않는다
	if (Object.keys(next.translations).length === 0) return;
	const dir = dataDir(project.bookId);
	const tmp = path.join(dir, 'project.json.tmp');
	mkdirSync(dir, { recursive: true });
	writeFileSync(tmp, JSON.stringify(next));
	renameSync(tmp, path.join(dir, 'project.json'));
	dirty = false;
}

/* ---------- 스냅샷: 되돌릴 지점 ---------- */

function snapshotDir(bookId: string) {
	return path.join(dataDir(bookId), 'snapshots');
}

async function readIndex(bookId: string): Promise<Snapshot[]> {
	try {
		return JSON.parse(await readFile(path.join(snapshotDir(bookId), 'index.json'), 'utf8'));
	} catch {
		return [];
	}
}

export async function listSnapshots(): Promise<Snapshot[]> {
	const p = await getProject();
	return p ? (await readIndex(p.bookId)).sort((a, b) => b.at - a.at) : [];
}

/** copy the current project aside; returns null when nothing is open */
export async function snapshotProject(label: string, auto = true): Promise<Snapshot | null> {
	if (!project) return null;
	const { bookId } = project;
	const dir = snapshotDir(bookId);
	const at = Date.now();
	const entry: Snapshot = {
		id: String(at),
		at,
		label,
		auto,
		done: project.chapters.reduce(
			(n, c) => n + c.blocks.filter((b) => b.status !== 'untranslated').length,
			0
		),
		total: project.chapters.reduce((n, c) => n + c.blocks.length, 0)
	};
	// 번역만 담는다 — 원문은 source.epub에만 있으므로 스냅샷 20개가 책을 20번 복사하지 않는다
	await writeJson(path.join(dir, `${entry.id}.json`), toStored(project));

	const index = [...(await readIndex(bookId)), entry];
	while (index.length > MAX_SNAPSHOTS) {
		// 사람이 이름 붙여 만든 지점은 마지막까지 남긴다 — 자동 스냅샷부터, 그 안에서 오래된 순
		const older = (a: Snapshot, b: Snapshot) =>
			a.auto === b.auto ? (a.at <= b.at ? a : b) : a.auto ? a : b;
		const victim = index.reduce(older);
		index.splice(index.indexOf(victim), 1);
		await rm(path.join(dir, `${victim.id}.json`), { force: true });
	}
	await writeJson(path.join(dir, 'index.json'), index);
	return entry;
}

export async function restoreSnapshot(id: string): Promise<boolean> {
	const current = await getProject();
	if (!current || !sourceEpub || !/^\d+$/.test(id)) return false; // 경로 조작 차단
	const file = path.join(snapshotDir(current.bookId), `${id}.json`);
	let stored: StoredProject;
	try {
		stored = toStoredV2(JSON.parse(await readFile(file, 'utf8')), sourceSha);
	} catch {
		return false;
	}
	if (stored.bookId !== current.bookId) return false;
	await snapshotProject('되돌리기 전');
	// 원문은 다시 파싱하고 스냅샷의 번역만 얹는다 — 옛 스냅샷도 현재 원본 기준으로 검증된다
	project = join(parseEpub(sourceEpub).project, stored);
	await persistNow();
	return true;
}

/* ---------- 작업파일: 다른 곳에 백업했다가 되살리기 ---------- */

/**
 * 밖에서 온 파일이 원문을 되돌려 넣을 수 없도록, 번역 맵만 받는다.
 * v1(원문 사본까지 담겼던 형식)도 toStoredV2가 흡수한다.
 */
export type WorkFile = Record<string, unknown>;

/**
 * Merge a work file into the open book by block id — never a wholesale replace,
 * since the file arrives from outside and the block ids must line up with the epub.
 * Returns how many blocks were applied.
 */
export async function importWorkFile(
	incoming: WorkFile,
	sanitize: (html: string) => string
): Promise<number> {
	const current = await getProject();
	if (!current) throw new Error('먼저 EPUB을 여세요');
	if (incoming.version !== 1 && incoming.version !== 2) {
		throw new Error('알 수 없는 작업파일 형식입니다');
	}
	if (incoming.bookId !== current.bookId) throw new Error('이 작업파일은 다른 책의 것입니다');

	await snapshotProject('작업파일 불러오기 전');
	const stored = toStoredV2(incoming, sourceSha);
	const byId = new Map<string, Block>();
	for (const chapter of current.chapters) for (const block of chapter.blocks) byId.set(block.id, block);

	// 파일에 없는 블록은 번역이 없었다는 뜻 — 현재 상태를 덮어써 스냅샷처럼 정확히 복원한다
	let applied = 0;
	for (const block of byId.values()) {
		const t = stored.translations[block.id];
		if (!t) {
			block.targetHtml = null;
			block.status = 'untranslated';
			block.srcHash = null;
			block.stale = false;
			continue;
		}
		block.targetHtml = sanitize(t.targetHtml);
		block.status = STATUSES.includes(t.status) ? t.status : 'machine';
		block.updatedAt = Number(t.updatedAt) || Date.now();
		block.srcHash = t.srcHash;
		block.stale = t.srcHash !== sourceHash(block.sourceHtml);
		applied++;
	}
	current.typography = stored.typography;
	current.codex = stored.codex;
	current.translationGuide = stored.translationGuide;
	await persistNow();
	return applied;
}
