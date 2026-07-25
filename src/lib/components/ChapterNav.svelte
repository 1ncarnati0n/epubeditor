<script lang="ts">
	import { editor, openChapter } from '$lib/client/state.svelte';
	import type { ChapterSummary } from '$lib/types';

	function label(c: ChapterSummary): string {
		return c.title?.split('\n')[0].trim() || (c.href.split('/').pop() ?? c.id);
	}

	/** Codex가 지금 붙들고 있는 챕터 — 어디를 하고 있는지 한눈에 */
	const working = $derived(
		editor.codex?.job.state === 'running' ? editor.codex.job.chapterId : null
	);
</script>

<nav>
	<div class="head">차례</div>
	{#each editor.project?.chapters ?? [] as c (c.id)}
		{#if c.total > 0}
			<button
				class="ch"
				class:active={editor.chapterId === c.id}
				class:working={working === c.id}
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
		{/if}
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
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		color: var(--muted);
		padding: 1rem 1rem 0.5rem;
	}
	.ch {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.55rem 1rem 0.65rem;
		border-left: 2px solid transparent;
	}
	.ch:hover {
		background: var(--paper);
	}
	.ch.active {
		background: var(--paper);
		border-left-color: var(--sealed);
	}
	/* 지금 Codex가 번역 중인 챕터 */
	.ch.working {
		border-left-color: var(--draft);
		background: color-mix(in srgb, var(--draft) 6%, transparent);
	}
	.ch.working .name::after {
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
