<script lang="ts">
	import type { Block } from '$lib/types';
	import { editor, saveBlock, setCursor, translateBlock } from '$lib/client/state.svelte';

	let { block }: { block: Block } = $props();

	const current = $derived(editor.cursor === block.id);

	let el: HTMLDivElement | undefined = $state();
	let focused = false;
	/** 요청을 보낸 뒤 job 상태가 돌아오기 전까지 — Codex 준비 확인에 1~2초 걸린다 */
	let pending = $state(false);
	let failure = $state<string | null>(null);

	const job = $derived(editor.codex?.job);
	const codexReady = $derived(
		editor.codex?.cli === 'ready' && editor.codex?.connection === 'connected'
	);
	/** 이 블록이 Codex에서 돌고 있거나 차례를 기다리는가 */
	const translating = $derived(
		pending ||
			(job?.state === 'running' &&
				(job.blockId === block.id || job.queuedIds.includes(block.id)))
	);
	/** chapter/책 번역 중에는 블록 단추가 통하지 않는다 */
	const blockedByJob = $derived(
		(job?.state === 'running' || job?.state === 'stopping') && job?.scope !== 'block'
	);
	const translateTitle = $derived(
		failure ??
			(translating
				? 'Codex가 번역 중'
				: block.status === 'untranslated'
					? '이 블록 Codex로 번역'
					: '이 블록 다시 번역')
	);

	async function runCodex() {
		pending = true;
		failure = null;
		try {
			failure = await translateBlock(block.id);
		} catch {
			failure = 'Codex 요청에 실패했습니다';
		} finally {
			pending = false;
		}
		if (failure) setTimeout(() => (failure = null), 5000);
	}

	// SSE/저장으로 갱신된 번역을 반영하되, 편집 중인 칸은 건드리지 않는다
	$effect(() => {
		const html = block.targetHtml ?? '';
		if (el && !focused && el.innerHTML !== html) el.innerHTML = html;
	});

	function commit() {
		focused = false;
		const html = el?.innerHTML ?? '';
		if (html !== (block.targetHtml ?? '')) void saveBlock(block.id, { targetHtml: html });
	}

	function toggleReviewed() {
		if (block.status === 'machine') void saveBlock(block.id, { status: 'reviewed' });
		else if (block.status === 'reviewed') void saveBlock(block.id, { status: 'machine' });
	}

	function onpaste(e: ClipboardEvent) {
		e.preventDefault();
		document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
	}

	const stitchTitle = $derived(
		block.status === 'untranslated'
			? '미번역'
			: block.status === 'machine'
				? '초벌 — 클릭해 검수 완료'
				: '검수됨 — 클릭해 초벌로 되돌리기'
	);
</script>

<div
	class="row"
	role="group"
	aria-label="{block.tag} 블록"
	class:fresh={editor.fresh[block.id]}
	class:stale={block.stale}
	class:current
	data-tag={block.tag}
	data-block={block.id}
	aria-current={current ? 'true' : undefined}
	onpointerdown={() => setCursor(block.id)}
>
	<div class="cell src" data-tag={block.tag} title="원문 — 읽기 전용">
		{@html block.sourceHtml}
	</div>
	<div class="gutter">
		<button
			class="stitch {block.status}"
			onclick={toggleReviewed}
			disabled={block.status === 'untranslated'}
			title={stitchTitle}
			aria-label={stitchTitle}
		></button>
		{#if codexReady}
			<button
				class="run"
				class:busy={translating}
				class:failed={failure}
				disabled={translating || blockedByJob}
				onclick={runCodex}
				title={translateTitle}
				aria-label={translateTitle}
			>
				{#if translating}
					<span class="spin" aria-hidden="true"></span>
				{:else}
					<span aria-hidden="true">▸</span>
				{/if}
			</button>
		{/if}
	</div>
	<div
		class="cell tgt"
		data-tag={block.tag}
		contenteditable="true"
		bind:this={el}
		role="textbox"
		aria-label="한국어 번역"
		tabindex="0"
		onfocus={() => (focused = true)}
		onblur={commit}
		oninput={() => (editor.save.dirty = true)}
		{onpaste}
	></div>
</div>

<style>
	.row {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 34px 1fr;
		border-bottom: 1px solid var(--line);
	}
	/* 키보드로 훑을 때 지금 어디인지 — 배경이 아니라 양 끝 표시선으로 (읽기를 방해하지 않게) */
	.row.current::before,
	.row.current::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: -1px;
		width: 3px;
		background: var(--sealed);
	}
	.row.current::before {
		left: 0;
	}
	.row.current::after {
		right: 0;
	}
	.row.current {
		background: color-mix(in srgb, var(--sealed) 3%, transparent);
	}
	/* 방금 도착한 번역 — 배경 페이드 + 치자색 가장자리 (현재 행의 쪽빛과 구분된다) */
	.row.fresh .tgt {
		animation: ink 3.8s ease-out;
		box-shadow: inset -3px 0 0 var(--draft);
	}
	@keyframes ink {
		0% {
			background: var(--fresh);
		}
		55% {
			background: var(--fresh);
		}
		100% {
			background: transparent;
		}
	}
	.cell {
		padding: var(--row-pad-y) var(--row-pad-x);
		min-height: 2.5rem;
	}
	.src {
		position: relative;
		font-family: var(--font-en);
		font-size: 0.98rem;
		line-height: 1.65;
		color: color-mix(in srgb, var(--ink) 88%, var(--muted));
	}
	/* 원문은 읽기 전용 — 행에 손이 닿을 때만 조용히 알린다 */
	.row:hover .src::after {
		content: '읽기 전용';
		position: absolute;
		top: 0.3rem;
		right: 0.5rem;
		color: var(--muted);
		font-family: var(--font-ko);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		opacity: 0.55;
	}
	/* 번역한 뒤 원문이 바뀐 행 */
	.row.stale {
		background: color-mix(in srgb, var(--warn) 4%, transparent);
	}
	.row.stale .src {
		box-shadow: inset 3px 0 0 var(--warn);
	}
	/* 조판에서 고른 서체를 작업하는 자리에서도 보이게 (--font-target은 +page.svelte가 설정) */
	.tgt {
		font-family: var(--font-target, var(--font-ko));
		font-size: 0.95rem;
		line-height: 1.8;
	}
	.tgt:empty::before {
		content: '번역 대기';
		color: var(--muted);
		opacity: 0.55;
	}
	.tgt:focus {
		outline: none;
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--sealed);
	}
	/* 제목 블록은 두 컬럼 모두 크게 */
	.cell[data-tag='h1'],
	.cell[data-tag='h2'] {
		font-size: 1.35rem;
		font-weight: 700;
		line-height: 1.4;
	}
	.cell[data-tag='h3'],
	.cell[data-tag='h4'] {
		font-size: 1.1rem;
		font-weight: 700;
	}
	.cell[data-tag='blockquote'] {
		font-style: italic;
		padding-left: 1.8rem;
	}

	/* 거터: 제본선 + 상태 스티치 + 블록 번역 단추 */
	.gutter {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding-top: calc(var(--row-pad-y) + 0.3rem);
	}
	.gutter::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 50%;
		width: 1px;
		background: var(--line);
	}
	.stitch {
		position: relative;
		z-index: 1;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 1.5px solid var(--muted);
		background: var(--paper);
		padding: 0;
	}
	.stitch:disabled {
		cursor: default;
		border-style: dotted;
	}
	.stitch.machine {
		border-color: var(--draft);
		background: color-mix(in srgb, var(--draft) 30%, var(--paper));
	}
	.stitch.reviewed {
		border-color: var(--sealed);
		background: var(--sealed);
	}

	/* 평소엔 숨어 있다가 행에 손이 닿으면 나온다 */
	.run {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--paper);
		color: var(--muted);
		font-size: 0.6rem;
		line-height: 1;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.row:hover .run,
	.row:focus-within .run,
	.run:focus-visible,
	.run.busy {
		opacity: 1;
	}
	.run:hover:not(:disabled) {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.run:disabled {
		cursor: default;
	}
	.run.busy {
		border-color: var(--draft);
	}
	.run.failed {
		opacity: 1;
		border-color: var(--warn);
		color: var(--warn);
	}
	.spin {
		width: 9px;
		height: 9px;
		border: 1.5px solid color-mix(in srgb, var(--draft) 30%, transparent);
		border-top-color: var(--draft);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
