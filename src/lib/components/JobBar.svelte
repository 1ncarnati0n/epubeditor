<script lang="ts">
	import { editor, stopCodexTranslation } from '$lib/client/state.svelte';

	const job = $derived(editor.codex?.job);
	const running = $derived(job?.state === 'running' || job?.state === 'stopping');
	const pct = $derived(job?.total ? Math.min(100, (job.translated / job.total) * 100) : 0);

	// 지금까지의 속도로 남은 시간을 어림한다 — 정확할 필요는 없고 "한참 남았나"를 알면 된다
	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	/** 설정을 바꿨을 때 이득을 눈으로 확인할 수 있도록 실측치를 보여준다 */
	const rate = $derived.by(() => {
		if (!job?.startedAt || !job.translated) return null;
		const perMin = job.translated / ((now - job.startedAt) / 60_000);
		return perMin >= 1 ? `${perMin.toFixed(0)} 블록/분` : `${perMin.toFixed(1)} 블록/분`;
	});
	const eta = $derived.by(() => {
		if (!job?.startedAt || !job.translated || !job.total) return null;
		const perBlock = (now - job.startedAt) / job.translated;
		const leftMs = perBlock * (job.total - job.translated);
		if (leftMs <= 0) return null;
		const done = new Date(now + leftMs);
		const mins = Math.round(leftMs / 60_000);
		const when = done.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
		return mins < 2 ? '곧 끝남' : `${when} 완료 예정 (${mins < 90 ? `${mins}분` : `${(mins / 60).toFixed(1)}시간`})`;
	});
	const pdf = $derived(editor.pdfJob);
	const pdfPct = $derived(pdf?.total ? Math.min(100, (pdf.done / pdf.total) * 100) : 0);
	const chapterName = $derived(
		editor.project?.chapters.find((c) => c.id === job?.chapterId)?.title ?? job?.chapterId ?? ''
	);
</script>

{#if pdf && (pdf.state === 'running' || pdf.message)}
	<div class="jobbar" role="status" aria-live="polite">
		{#if pdf.state === 'running'}
			<div class="track" aria-hidden="true"><i style:width="{pdfPct}%"></i></div>
		{/if}
		<div class="line">
			{#if pdf.state === 'running'}
				<span class="dot" aria-hidden="true"></span>
				<strong>{pdf.phase === 'read' ? 'PDF 읽는 중' : '수식 인식 중'}</strong>
				<span class="what">{pdf.fileName}</span>
				<span class="num">{pdf.done}/{pdf.total}{pdf.phase === 'read' ? '쪽' : '쪽 (Codex)'}</span>
				{#if pdf.mathPages}<span class="q">수식 페이지 {pdf.mathPages}</span>{/if}
			{:else}
				<strong class="retry">{pdf.state === 'failed' ? '변환 실패' : '변환 완료'}</strong>
				<span class="what" title={pdf.message}>{pdf.message}</span>
				<button onclick={() => (editor.pdfJob = null)}>닫기</button>
			{/if}
		</div>
	</div>
{/if}

{#if running}
	<div class="jobbar" role="status" aria-live="polite">
		<div class="track" aria-hidden="true">
			<i style:width="{pct}%"></i>
		</div>
		<div class="line">
			<span class="dot" aria-hidden="true"></span>
			{#if job?.attempt}
				<strong class="retry">
					일시 오류 · 재시도 {job.attempt}/5{job.retryInSec ? ` · ${job.retryInSec}초 후` : ''}
				</strong>
			{:else}
				<strong>{job?.state === 'stopping' ? '중지하는 중' : '번역 중'}</strong>
			{/if}
			<span class="what">{chapterName}</span>
			<span class="num">{job?.translated ?? 0}/{job?.total ?? 0}</span>
			{#if editor.arrived}<span class="new">+{editor.arrived}</span>{/if}
			{#if job && job.workers > 1}<span class="q">동시 {job.workers}</span>{/if}
			{#if job?.queuedIds.length}<span class="q">대기 {job.queuedIds.length}</span>{/if}
			{#if rate}<span class="rate">{rate}</span>{/if}
			{#if eta}<span class="eta">{eta}</span>{/if}
			<button disabled={job?.state === 'stopping'} onclick={() => void stopCodexTranslation()}>
				중지
			</button>
		</div>
	</div>
{/if}

<style>
	.jobbar {
		position: relative;
		z-index: 12;
		flex-shrink: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--draft) 35%, var(--line));
		background: color-mix(in srgb, var(--draft) 7%, var(--paper));
	}
	.track {
		height: 3px;
		background: color-mix(in srgb, var(--draft) 18%, transparent);
	}
	.track i {
		display: block;
		height: 100%;
		background: var(--draft);
		transition: width 0.4s ease-out;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.3rem 1.25rem;
		font-size: 0.76rem;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--draft);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
	strong {
		color: var(--draft);
		white-space: nowrap;
	}
	strong.retry {
		color: var(--warn);
	}
	.what {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
	}
	.num,
	.eta,
	.q {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.rate {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.new {
		color: var(--draft);
		font-variant-numeric: tabular-nums;
	}
	button {
		border: 1px solid color-mix(in srgb, var(--draft) 45%, transparent);
		padding: 0.12rem 0.6rem;
		color: var(--draft);
		font-size: 0.72rem;
	}
	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
