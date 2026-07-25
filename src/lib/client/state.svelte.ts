import { browser } from '$app/environment';
import type { Block, BlockStatus, Chapter, ProjectSummary, Typography } from '$lib/types';

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
	/** 미리보기 iframe 강제 리로드 카운터 (조판 변경·수동 새로고침 시 증가) */
	previewRev: 0
});

export async function boot(): Promise<void> {
	if (!browser) return;
	await refreshProject();
	const first = editor.project?.chapters.find((c) => c.total > 0);
	if (first) await openChapter(first.id);
	editor.booting = false;
	connect();
}

export async function refreshProject(): Promise<void> {
	const res = await fetch('/api/project');
	editor.project = res.ok ? await res.json() : null;
}

export async function openChapter(id: string): Promise<void> {
	editor.chapterId = id;
	const res = await fetch(`/api/chapters/${id}`);
	editor.chapter = res.ok ? await res.json() : null;
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
			editor.fresh[incoming.id] = true;
			setTimeout(() => delete editor.fresh[incoming.id], 1800);
		}
	}
}

export async function saveTypography(patch: Partial<Typography>): Promise<void> {
	if (!editor.project) return;
	Object.assign(editor.project.typography, patch);
	editor.previewRev++;
	await fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
}

function connect(): void {
	const es = new EventSource('/api/events');
	es.onopen = () => (editor.sse = true);
	es.onerror = () => (editor.sse = false); // EventSource가 알아서 재접속
	es.onmessage = (ev) => {
		const event = JSON.parse(ev.data);
		if (event.type === 'blocks') {
			mergeBlocks(event.chapterId, event.blocks, true);
			void refreshProject();
		} else if (event.type === 'project') {
			void refreshProject().then(() => {
				if (editor.chapterId) void openChapter(editor.chapterId);
			});
		}
	};
}
