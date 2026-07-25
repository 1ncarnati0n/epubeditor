import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Block, BlockStatus, Chapter, Project } from '$lib/types';
import { parseEpub } from './epub/parse';

const DATA_DIR = path.resolve('data');

// ponytail: single active project held in module state — multi-project UI is a v2 concern
let project: Project | null = null;
let sourceEpub: Uint8Array | null = null;
let entriesCache: Record<string, Uint8Array> | null = null;
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function dataDir(bookId: string) {
	return path.join(DATA_DIR, bookId);
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
		project = JSON.parse(await readFile(path.join(DATA_DIR, best.dir, 'project.json'), 'utf8'));
		sourceEpub = new Uint8Array(await readFile(path.join(DATA_DIR, best.dir, 'source.epub')));
	} catch (e) {
		console.error('failed to restore project from disk:', e);
		project = null;
		sourceEpub = null;
	}
}

export async function openEpub(buf: Uint8Array): Promise<Project> {
	const parsed = parseEpub(buf);
	let proj = parsed.project;
	try {
		// same bytes uploaded before -> resume existing translation work
		const prior = JSON.parse(
			await readFile(path.join(dataDir(proj.bookId), 'project.json'), 'utf8')
		) as Project;
		if (prior.version === 1 && prior.bookId === proj.bookId) proj = prior;
	} catch {
		// fresh project
	}
	await mkdir(dataDir(proj.bookId), { recursive: true });
	await writeFile(path.join(dataDir(proj.bookId), 'source.epub'), buf);
	project = proj;
	sourceEpub = buf;
	entriesCache = parsed.entries;
	hydrated = true;
	await persistNow();
	return proj;
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

export function setBlock(block: Block, targetHtml: string | null, status: BlockStatus) {
	block.targetHtml = targetHtml;
	block.status = status;
	block.updatedAt = Date.now();
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
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => void persistNow().catch(console.error), 500);
}

export async function persistNow(): Promise<void> {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	if (!project) return;
	const dir = dataDir(project.bookId);
	await mkdir(dir, { recursive: true });
	const tmp = path.join(dir, 'project.json.tmp');
	await writeFile(tmp, JSON.stringify(project));
	await rename(tmp, path.join(dir, 'project.json'));
}
