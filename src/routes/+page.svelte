<script lang="ts">
	import { editor, boot, uploadEpub } from '$lib/client/state.svelte';
	import UploadDrop from '$lib/components/UploadDrop.svelte';
	import ChapterNav from '$lib/components/ChapterNav.svelte';
	import BlockRow from '$lib/components/BlockRow.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';

	$effect(() => {
		void boot();
	});

	const totals = $derived.by(() => {
		const t = { total: 0, machine: 0, reviewed: 0 };
		for (const c of editor.project?.chapters ?? []) {
			t.total += c.total;
			t.machine += c.machine;
			t.reviewed += c.reviewed;
		}
		return t;
	});
	const pct = $derived(
		totals.total ? Math.round(((totals.machine + totals.reviewed) / totals.total) * 100) : 0
	);
</script>

<svelte:head>
	<title>{editor.project ? `${editor.project.title} — epubeditor` : 'epubeditor'}</title>
</svelte:head>

{#if editor.booting}
	<!-- 첫 fetch 대기 -->
{:else if !editor.project}
	<UploadDrop />
{:else}
	<div class="app">
		<header>
			<div class="book">
				<strong>{editor.project.title}</strong>
				{#if editor.project.creator}<span class="by">{editor.project.creator}</span>{/if}
			</div>
			<div
				class="progress"
				title="검수 {totals.reviewed} · 초벌 {totals.machine} · 전체 {totals.total} 블록"
			>
				<span class="spine" aria-hidden="true">
					<i class="rev" style:width="{totals.total ? (totals.reviewed / totals.total) * 100 : 0}%"
					></i>
					<i class="mac" style:width="{totals.total ? (totals.machine / totals.total) * 100 : 0}%"
					></i>
				</span>
				<span class="num">{pct}%</span>
			</div>
			<div class="views" role="group" aria-label="보기 전환">
				<button
					class:on={editor.view === 'edit'}
					onclick={() => (editor.view = 'edit')}>편집</button
				>
				<button
					class:on={editor.view === 'preview'}
					onclick={() => {
						editor.view = 'preview';
						editor.previewRev++;
					}}>미리보기</button
				>
			</div>
			<button
				class="tool"
				class:on={editor.settingsOpen}
				onclick={() => (editor.settingsOpen = !editor.settingsOpen)}>조판</button
			>
			<a class="tool" href="/api/export" download>내보내기</a>
			<label class="reopen">
				다른 책 열기
				<input
					type="file"
					accept=".epub,application/epub+zip"
					hidden
					onchange={(e) => {
						const f = e.currentTarget.files?.[0];
						if (f) void uploadEpub(f);
					}}
				/>
			</label>
		</header>
		<div class="body" class:with-settings={editor.settingsOpen}>
			<ChapterNav />
			<main class:editing={editor.view === 'edit'}>
				{#if !editor.chapter}
					<p class="hint">왼쪽 차례에서 챕터를 선택하세요</p>
				{:else if editor.view === 'edit'}
					<div class="colhead" aria-hidden="true">
						<span>원문 · EN</span><span></span><span>번역 · KO</span>
					</div>
					{#each editor.chapter.blocks as block (block.id)}
						<BlockRow {block} />
					{/each}
				{:else}
					{#key `${editor.chapterId}:${editor.previewRev}`}
						<iframe class="preview" title="미리보기" src="/preview/{editor.chapterId}"></iframe>
					{/key}
				{/if}
			</main>
			{#if editor.settingsOpen}
				<SettingsPanel />
			{/if}
		</div>
	</div>
{/if}

<style>
	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0 1.25rem;
		height: 52px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.book {
		min-width: 0;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.book strong {
		font-family: var(--font-en);
		font-size: 1.05rem;
	}
	.by {
		color: var(--muted);
		margin-left: 0.6rem;
		font-size: 0.85rem;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.spine {
		display: flex;
		width: 180px;
		height: 4px;
		background: var(--line);
		overflow: hidden;
	}
	.spine i {
		height: 100%;
	}
	.rev {
		background: var(--sealed);
	}
	.mac {
		background: var(--draft);
	}
	.num {
		font-size: 0.8rem;
		color: var(--muted);
		min-width: 2.6em;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.reopen {
		font-size: 0.8rem;
		color: var(--muted);
		cursor: pointer;
		border: 1px solid var(--line);
		padding: 0.3rem 0.7rem;
	}
	.reopen:hover {
		color: var(--ink);
		border-color: var(--muted);
	}
	.views {
		display: flex;
		border: 1px solid var(--line);
	}
	.views button,
	.tool {
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
		color: var(--muted);
		text-decoration: none;
	}
	.views button.on {
		background: var(--ink);
		color: var(--paper);
	}
	.tool {
		border: 1px solid var(--line);
	}
	.tool.on {
		border-color: var(--sealed);
		color: var(--sealed);
	}

	.body {
		flex: 1;
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 0;
	}
	.body.with-settings {
		grid-template-columns: 240px 1fr auto;
	}
	.preview {
		width: 100%;
		height: 100%;
		border: none;
		background: white;
	}
	main {
		overflow-y: auto;
	}
	main.editing {
		padding-bottom: 40vh;
	}
	.colhead {
		position: sticky;
		top: 0;
		z-index: 2;
		display: grid;
		grid-template-columns: 1fr 34px 1fr;
		background: color-mix(in srgb, var(--paper) 92%, transparent);
		backdrop-filter: blur(4px);
		border-bottom: 1px solid var(--line);
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		color: var(--muted);
	}
	.colhead span {
		padding: 0.5rem 1.1rem;
	}
	.hint {
		color: var(--muted);
		padding: 3rem;
		text-align: center;
	}
</style>
