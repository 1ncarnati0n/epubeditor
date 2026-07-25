<script lang="ts">
	import Segmented from './Segmented.svelte';
	import { editor, goToBlock, replaceAll, search, type SearchHit } from '$lib/client/state.svelte';

	let q = $state('');
	let where = $state<'source' | 'target'>('target');
	let hits = $state<SearchHit[]>([]);
	let truncated = $state(false);
	let searching = $state(false);

	let replaceOpen = $state(false);
	let to = $state('');
	let preview = $state<number | null>(null);
	let notice = $state<string | null>(null);
	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		input?.focus();
	});

	// 타이핑이 멈추면 찾는다 — 5,000블록을 매 글자마다 훑지 않게
	$effect(() => {
		const term = q.trim();
		const scope = where;
		if (!term) {
			hits = [];
			preview = null;
			return;
		}
		searching = true;
		const timer = setTimeout(async () => {
			const result = await search(term, scope);
			hits = result.hits;
			truncated = result.truncated;
			searching = false;
		}, 250);
		return () => clearTimeout(timer);
	});

	async function countReplacements() {
		notice = null;
		const result = await replaceAll(q.trim(), to, true);
		if (typeof result === 'string') notice = result;
		else preview = result.matched;
	}

	async function applyReplacements() {
		notice = null;
		const result = await replaceAll(q.trim(), to, false);
		if (typeof result === 'string') {
			notice = result;
			return;
		}
		notice = `${result.applied}개 블록을 바꿨습니다. 되돌리려면 저장 패널의 스냅샷을 쓰세요.`;
		preview = null;
		hits = [];
		q = '';
		to = '';
	}
</script>

<div class="bar" role="search">
	<div class="line">
		<input
			bind:this={input}
			bind:value={q}
			type="search"
			placeholder="책 전체에서 찾기"
			aria-label="검색어"
		/>
		<Segmented
			size="small"
			label="검색 대상"
			value={where}
			items={[
				{ key: 'target', label: '번역' },
				{ key: 'source', label: '원문' }
			]}
			pick={(key) => (where = key as 'source' | 'target')}
		/>
		<span class="count">
			{#if searching}찾는 중…{:else if q.trim()}{hits.length}{truncated ? '+' : ''}건{/if}
		</span>
		<button
			class="link"
			class:on={replaceOpen}
			disabled={where === 'source'}
			title={where === 'source' ? '원문은 바꿀 수 없습니다' : '번역문 일괄 치환'}
			onclick={() => (replaceOpen = !replaceOpen)}>치환</button
		>
		<button class="link" onclick={() => (editor.searchOpen = false)} aria-label="검색 닫기">✕</button>
	</div>

	{#if replaceOpen && where === 'target'}
		<div class="line replace">
			<input bind:value={to} type="text" placeholder="바꿀 말 (비우면 삭제)" aria-label="바꿀 말" />
			<button class="link" disabled={!q.trim()} onclick={countReplacements}>몇 개인지 보기</button>
			{#if preview !== null}
				<span class="count">{preview}개</span>
				<button class="apply" disabled={preview === 0} onclick={applyReplacements}>
					{preview}개 바꾸기
				</button>
			{/if}
			<small>번역문만 바뀝니다. 태그 안쪽은 건드리지 않고, 바꾸기 전 스냅샷이 남습니다.</small>
		</div>
	{/if}

	{#if notice}<p class="notice">{notice}</p>{/if}

	{#if hits.length}
		<ul>
			{#each hits.slice(0, 50) as hit (hit.blockId + where)}
				<li>
					<button onclick={() => goToBlock(hit.chapterId, hit.blockId)}>
						<span class="where">{hit.chapterTitle ?? hit.chapterId}</span>
						<span class="text">{hit.text}</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if hits.length > 50}<p class="more">위 50건만 표시 · 전체 {hits.length}{truncated ? '+' : ''}건</p>{/if}
	{/if}
</div>

<style>
	.bar {
		flex-shrink: 0;
		border-bottom: 1px solid var(--line);
		background: var(--paper-dim);
		padding: 0.5rem 1.25rem 0.6rem;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.line.replace {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--line);
	}
	input {
		flex: 1;
		max-width: 26rem;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.35rem 0.5rem;
		color: inherit;
		font: inherit;
		font-size: 0.82rem;
	}
	input:focus {
		outline: none;
		border-color: var(--sealed);
	}
	.count {
		min-width: 4rem;
		color: var(--muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.link {
		color: var(--muted);
		font-size: 0.78rem;
	}
	.link:hover:not(:disabled),
	.link.on {
		color: var(--sealed);
	}
	.link:disabled {
		cursor: default;
		opacity: 0.4;
	}
	.apply {
		border: 1px solid var(--draft);
		padding: 0.25rem 0.7rem;
		color: var(--draft);
		font-size: 0.76rem;
	}
	.apply:disabled {
		cursor: default;
		opacity: 0.4;
	}
	.line.replace small {
		color: var(--muted);
		font-size: 0.68rem;
	}
	.notice {
		margin: 0.5rem 0 0;
		color: var(--sealed);
		font-size: 0.76rem;
	}
	ul {
		max-height: 34vh;
		overflow-y: auto;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}
	li button {
		display: flex;
		gap: 0.7rem;
		width: 100%;
		border-top: 1px solid var(--line);
		padding: 0.35rem 0;
		text-align: left;
	}
	li button:hover {
		background: var(--paper);
	}
	.where {
		flex-shrink: 0;
		width: 11rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: 0.72rem;
	}
	.text {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
	}
	.more {
		margin: 0.4rem 0 0;
		color: var(--muted);
		font-size: 0.7rem;
	}
</style>
