import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntries, getProject, staleBlocks } from '$lib/server/store';
import { exportEpub } from '$lib/server/epub/export';

export const GET: RequestHandler = async () => {
	const project = await getProject();
	const entries = await getEntries();
	if (!project || !entries) error(404, 'no project loaded');

	// 원문이 바뀐 번역이 남아 있으면 내보내지 않는다 — 손상된 EPUB이 나가는 것보다 낫다
	const stale = staleBlocks(project);
	if (stale.length) {
		const chapters = [...new Set(stale.map((s) => s.chapterId))];
		error(
			409,
			`번역한 뒤 원문이 바뀐 block이 ${stale.length}개 있습니다 (chapter ${chapters.join(', ')}). 편집 화면 배너에서 확인한 뒤 다시 시도하세요.`
		);
	}
	const epub = await exportEpub(project, entries);
	const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'book';
	const suffix = project.typography.bilingual ? '대역' : 'ko';
	const filename = encodeURIComponent(`${safeTitle}-${suffix}.epub`);
	return new Response(new Uint8Array(epub), {
		headers: {
			'Content-Type': 'application/epub+zip',
			// ASCII fallback은 구형 클라이언트용, 실제 이름은 filename*
			'Content-Disposition': `attachment; filename="book-${project.typography.bilingual ? 'bilingual' : 'ko'}.epub"; filename*=UTF-8''${filename}`
		}
	});
};
