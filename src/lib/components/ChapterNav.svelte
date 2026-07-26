<script lang="ts">
	import {
		editor,
		isChapterPicked,
		listedChapters,
		openChapter,
		pickAllChapters,
		pickedChapters,
		toggleChapterPick
	} from '$lib/client/state.svelte';
	import type { ChapterSummary } from '$lib/types';

	function label(c: ChapterSummary): string {
		return c.title?.split('\n')[0].trim() || (c.href.split('/').pop() ?? c.id);
	}

	/** Codex가 지금 붙들고 있는 챕터 — 어디를 하고 있는지 한눈에 */
	const working = $derived(
		editor.codex?.job.state === 'running' ? editor.codex.job.chapterId : null
	);

	const listed = $derived(listedChapters());
	const picked = $derived(pickedChapters());
</script>

<nav>
	<div class="head">
		<span>차례</span>
		{#if listed.length}
			<span class="count">{picked.length}/{listed.length}</span>
			<button class="all" onclick={() => pickAllChapters(picked.length < listed.length)}>
				{picked.length < listed.length ? '전체 선택' : '전체 해제'}
			</button>
		{/if}
	</div>
	{#each listed as c (c.id)}
		{@const on = isChapterPicked(c.id)}
		<div class="row" class:active={editor.chapterId === c.id} class:working={working === c.id}>
			<input
				type="checkbox"
				checked={on}
				aria-label="{label(c)} — 책 전체 번역 대상"
				onchange={() => toggleChapterPick(c.id)}
			/>
			<button
				class="ch"
				class:off={!on}
				aria-current={editor.chapterId === c.id ? 'true' : undefined}
				onclick={() => {
					openChapter(c.id);
					editor.navOpen = false;
				}}
			>
				<span class="name">{label(c)}</span>
				<span class="meta">
					{c.reviewed + c.machine}/{c.total}
					{#if c.machine}<em title="검수 대기 초벌">· 검수 {c.machine}</em>{/if}
					{#if c.stale}<b title="원문이 바뀐 번역">· 확인 {c.stale}</b>{/if}
				</span>
				<span class="bar" aria-hidden="true">
					<i class="rev" style:width="{(c.reviewed / c.total) * 100}%"></i>
					<i class="mac" style:width="{(c.machine / c.total) * 100}%"></i>
				</span>
			</button>
		</div>
	{/each}
</nav>

<style>
	nav {
		overflow-y: auto;
		border-right: 1px solid var(--line);
		background: var(--paper-dim);
		padding-bottom: 2rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		color: var(--muted);
		padding: 1rem 1rem 0.5rem;
	}
	.head .count {
		margin-left: auto;
		letter-spacing: 0;
		font-variant-numeric: tabular-nums;
	}
	.head .all {
		border: 1px solid var(--line);
		padding: 0.15rem 0.4rem;
		color: var(--muted);
		font-size: 0.68rem;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.head .all:hover {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.row {
		display: flex;
		align-items: flex-start;
		border-left: 2px solid transparent;
	}
	.row input {
		flex: none;
		margin: 0.75rem 0 0 0.7rem;
		accent-color: var(--sealed);
	}
	.ch {
		/* min-width:0 이 없으면 flex 자식이 안 줄어들어 .name 말줄임이 죽는다 */
		flex: 1;
		min-width: 0;
		text-align: left;
		padding: 0.55rem 1rem 0.65rem 0.55rem;
	}
	.row:hover {
		background: var(--paper);
	}
	.row.active {
		background: var(--paper);
		border-left-color: var(--sealed);
	}
	/* 체크를 끈 챕터 — 책 전체 번역에서 빠진다 */
	.ch.off .name,
	.ch.off .meta {
		opacity: 0.45;
	}
	/* 지금 Codex가 번역 중인 챕터 */
	.row.working {
		border-left-color: var(--draft);
		background: color-mix(in srgb, var(--draft) 6%, transparent);
	}
	.row.working .name::after {
		content: '번역 중';
		margin-left: 0.45rem;
		color: var(--draft);
		font-size: 0.65rem;
		animation: blink 1.4s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.name {
		display: block;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 0.7rem;
		color: var(--muted);
	}
	.meta em {
		font-style: normal;
		color: var(--draft);
	}
	.meta b {
		font-weight: 400;
		color: var(--warn);
	}
	.bar {
		display: flex;
		height: 2px;
		background: var(--line);
		margin-top: 0.35rem;
	}
	.bar i {
		height: 100%;
	}
	.rev {
		background: var(--sealed);
	}
	.mac {
		background: var(--draft);
	}
</style>
