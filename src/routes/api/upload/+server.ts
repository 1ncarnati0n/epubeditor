import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openEpub } from '$lib/server/store';
import { projectSummary } from '$lib/types';
import { isTranslationActive } from '$lib/server/codex';
import { isPdfJobActive, startPdfJob } from '$lib/server/pdf';

export const POST: RequestHandler = async ({ request }) => {
	if (isTranslationActive()) error(409, 'Codex 번역을 먼저 중지하세요');
	if (isPdfJobActive()) error(409, 'PDF 변환이 끝난 뒤에 다시 올리세요');
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) error(400, 'multipart field "file" (epub|pdf) required');
	const bytes = new Uint8Array(await file.arrayBuffer());
	// %PDF — 변환은 길어질 수 있어 백그라운드로. 진행·완료는 SSE 'pdf' 이벤트로 간다
	if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
		return json(startPdfJob(bytes, file.name), { status: 202 });
	}
	try {
		const project = await openEpub(bytes);
		return json(projectSummary(project));
	} catch (e) {
		error(400, `not a valid EPUB: ${e instanceof Error ? e.message : String(e)}`);
	}
};
