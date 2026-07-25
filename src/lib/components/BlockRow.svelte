<script lang="ts">
	import type { Block } from '$lib/types';
	import { editor, saveBlock } from '$lib/client/state.svelte';

	let { block }: { block: Block } = $props();

	let el: HTMLDivElement | undefined = $state();
	let focused = false;

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

<div class="row" class:fresh={editor.fresh[block.id]} data-tag={block.tag}>
	<div class="cell src" data-tag={block.tag}>{@html block.sourceHtml}</div>
	<div class="gutter">
		<button
			class="stitch {block.status}"
			onclick={toggleReviewed}
			disabled={block.status === 'untranslated'}
			title={stitchTitle}
			aria-label={stitchTitle}
		></button>
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
		{onpaste}
	></div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 1fr 34px 1fr;
		border-bottom: 1px solid var(--line);
	}
	.row.fresh .tgt {
		animation: ink 1.6s ease-out;
	}
	@keyframes ink {
		from {
			background: var(--fresh);
		}
		to {
			background: transparent;
		}
	}
	.cell {
		padding: 0.8rem 1.1rem;
		min-height: 2.5rem;
	}
	.src {
		font-family: var(--font-en);
		font-size: 0.98rem;
		line-height: 1.65;
		color: color-mix(in srgb, var(--ink) 88%, var(--muted));
	}
	.tgt {
		font-family: var(--font-ko);
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

	/* 거터: 제본선 + 상태 스티치 */
	.gutter {
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 1.1rem;
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
</style>
