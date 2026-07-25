<script lang="ts">
	import {
		editor,
		boot,
		download,
		jumpToNextUnreviewed,
		matchesFilter,
		moveCursor,
		setCursor,
		type BlockFilter,
		refreshCodex,
		refreshSnapshots,
		resolveStale,
		saveBlock,
		saveNow,
		translateBlock,
		visibleBlocks
	} from '$lib/client/state.svelte';
	import UploadDrop from '$lib/components/UploadDrop.svelte';
	import ChapterNav from '$lib/components/ChapterNav.svelte';
	import BlockRow from '$lib/components/BlockRow.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import CodexPanel from '$lib/components/CodexPanel.svelte';
	import SavePanel from '$lib/components/SavePanel.svelte';
	import GuidePanel from '$lib/components/GuidePanel.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ShortcutHelp from '$lib/components/ShortcutHelp.svelte';
	import BookShelf from '$lib/components/BookShelf.svelte';
	import JobBar from '$lib/components/JobBar.svelte';
	import Segmented from '$lib/components/Segmented.svelte';

	let helpOpen = $state(false);
	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	const FILTERS = [
		{ key: 'all' as const, label: '전체', count: (c: Counts) => c.total },
		{ key: 'untranslated' as const, label: '미번역', count: (c: Counts) => c.untranslated },
		{ key: 'machine' as const, label: '초벌', count: (c: Counts) => c.machine },
		{ key: 'stale' as const, label: '원문 바뀜', count: (c: Counts) => c.stale }
	];
	type Counts = { total: number; untranslated: number; machine: number; stale: number };

	const counts = $derived.by<Counts>(() => {
		const c = { total: 0, untranslated: 0, machine: 0, stale: 0 };
		for (const b of editor.chapter?.blocks ?? []) {
			c.total++;
			if (b.stale) c.stale++;
			if (b.status === 'untranslated') c.untranslated++;
			else if (b.status === 'machine') c.machine++;
		}
		return c;
	});
	const rows = $derived((editor.chapter?.blocks ?? []).filter((b) => matchesFilter(b, editor.filter)));

	function pickFilter(key: BlockFilter) {
		editor.filter = key;
		// 커서가 숨겨진 행에 있으면 보이는 첫 행으로 데려온다
		if (!rows.some((b) => b.id === editor.cursor)) setCursor(visibleBlocks()[0]?.id ?? null);
	}

	// 조판에서 고른 서체를 편집 화면 번역 칸에도 흘려 넣는다
	$effect(() => {
		const font = editor.project?.typography.bodyFont;
		document.documentElement.style.setProperty(
			'--font-target',
			font === 'pretendard'
				? "'Pretendard', sans-serif"
				: font === 'noto-serif-kr'
					? "'Noto Serif KR', serif"
					: 'var(--font-ko)'
		);
	});

	async function runExport() {
		exporting = true;
		exportError = null;
		try {
			exportError = await download('/api/export');
		} finally {
			exporting = false;
		}
	}

	$effect(() => {
		void boot();
	});

	/** 하나만 열린다 — 전부 오른쪽 같은 자리를 쓴다 */
	function openPanel(which: 'settings' | 'codex' | 'save' | 'guide' | null) {
		editor.settingsOpen = which === 'settings';
		editor.codexOpen = which === 'codex';
		editor.saveOpen = which === 'save';
		editor.guideOpen = which === 'guide';
		if (which === 'codex') void refreshCodex();
		if (which === 'save') void refreshSnapshots();
	}

	/** 글을 치고 있는 중인가 — 단일 문자 단축키가 글자를 삼키면 안 된다 */
	function typing(): boolean {
		const el = document.activeElement as HTMLElement | null;
		return (
			!!el &&
			(el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
		);
	}

	function focusTarget(blockId: string | null) {
		if (!blockId) return;
		(
			document.querySelector(`[data-block="${CSS.escape(blockId)}"] .tgt`) as HTMLElement | null
		)?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		const cmd = e.metaKey || e.ctrlKey;
		const editing = typing();

		if (cmd && e.key === 's') {
			e.preventDefault();
			// 편집 중인 칸은 blur에서 커밋된다 — 먼저 빼내지 않으면 방금 친 글이 빠진 채 저장된다
			(document.activeElement as HTMLElement | null)?.blur();
			void saveNow();
			return;
		}
		// 검수 흐름의 중심 키: 확정하고 다음 초벌로
		if (cmd && e.key === 'Enter') {
			e.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			void approveAndAdvance();
			return;
		}
		if (cmd && e.key === 'f') {
			e.preventDefault();
			editor.searchOpen = true;
			return;
		}
		if (e.key === 'Escape') {
			if (editing) (document.activeElement as HTMLElement | null)?.blur();
			else if (helpOpen) helpOpen = false;
			else if (editor.searchOpen) editor.searchOpen = false;
			return;
		}
		if (editing || cmd || e.altKey || editor.view !== 'edit') return;

		if (e.key === 'ArrowDown' || e.key === 'j') {
			e.preventDefault();
			moveCursor(1);
		} else if (e.key === 'ArrowUp' || e.key === 'k') {
			e.preventDefault();
			moveCursor(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			focusTarget(editor.cursor);
		} else if (e.key === 't') {
			e.preventDefault();
			if (editor.cursor) void translateBlock(editor.cursor);
		} else if (e.key === '?') {
			e.preventDefault();
			helpOpen = !helpOpen;
		}
	}

	async function approveAndAdvance() {
		const id = editor.cursor;
		if (!id) return;
		const block = editor.chapter?.blocks.find((b) => b.id === id);
		if (block?.targetHtml && block.status !== 'reviewed') {
			await saveBlock(id, { status: 'reviewed' });
		}
		await jumpToNextUnreviewed();
	}

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
	const codexJob = $derived(editor.codex?.job);
	const codexRunning = $derived(
		codexJob?.state === 'running' || codexJob?.state === 'stopping'
	);
	const staleTotal = $derived(
		editor.project?.chapters.reduce((sum, c) => sum + c.stale, 0) ?? 0
	);

	let resolving = $state(false);
	async function resolve(action: 'keep' | 'discard') {
		resolving = true;
		try {
			await resolveStale(action);
		} finally {
			resolving = false;
		}
	}
</script>

<svelte:head>
	<title>{editor.project ? `${editor.project.title} — epubeditor` : 'epubeditor'}</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if editor.booting}
	<!-- 첫 fetch 대기 -->
{:else if !editor.project}
	<UploadDrop />
{:else}
	<div class="app">
		<JobBar />
		<header>
			<button
				class="navtoggle"
				aria-expanded={editor.navOpen}
				title="차례"
				onclick={() => (editor.navOpen = !editor.navOpen)}>☰</button
			>
			<button
				class="book"
				aria-expanded={editor.shelfOpen}
				title="책장 — 다른 책으로 전환"
				onclick={() => (editor.shelfOpen = !editor.shelfOpen)}
			>
				<strong>{editor.project.title}</strong>
				{#if editor.project.creator}<span class="by">{editor.project.creator}</span>{/if}
				<span class="caret" aria-hidden="true">▾</span>
			</button>
			<!-- Codex가 도는 동안엔 같은 자리를 작업 진행률로 내준다 (패널이 닫혀 있어도 보이게) -->
			{#if codexRunning}
				<button class="progress live" onclick={() => openPanel('codex')} title="Codex 진행 상황">
					<span class="spine" aria-hidden="true">
						<i
							class="mac"
							style:width="{codexJob?.total ? (codexJob.translated / codexJob.total) * 100 : 0}%"
						></i>
					</span>
					<span class="num">{codexJob?.translated ?? 0}/{codexJob?.total ?? 0}</span>
				</button>
			{:else}
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
			{/if}
			<Segmented
				size="small"
				label="보기 전환"
				value={editor.view}
				items={[
					{ key: 'edit', label: '편집' },
					{ key: 'preview', label: '미리보기' }
				]}
				pick={(key) => {
					editor.view = key;
					if (key === 'preview') editor.previewRev++;
				}}
			/>

			<!-- 도구: 이름 대신 기호 — 상태는 점으로, 이름은 툴팁으로 -->
			<div class="tools" role="group" aria-label="도구">
				<button
					class="tool save"
					class:on={editor.saveOpen}
					class:dirty={editor.save.dirty}
					title={editor.save.dirty ? '저장 대기 — ⌘S로 즉시 저장' : '저장됨 · 스냅샷'}
					onclick={() => openPanel(editor.saveOpen ? null : 'save')}
				>
					<i aria-hidden="true"></i>저장
				</button>
				<button
					class="tool guide"
					class:on={editor.guideOpen}
					class:set={!!editor.project.translationGuide}
					title="번역 지침 — Codex와 다른 MCP 클라이언트에 모두 전달됩니다"
					onclick={() => openPanel(editor.guideOpen ? null : 'guide')}
				>
					<i aria-hidden="true"></i>지침
				</button>
				<button
					class="tool"
					class:on={editor.settingsOpen}
					title="조판 — 폰트·행간·출력 형식"
					onclick={() => openPanel(editor.settingsOpen ? null : 'settings')}>조판</button
				>
				<button
					class="tool codex"
					class:on={editor.codexOpen}
					class:running={codexRunning}
					title="Codex MCP — 자동 번역"
					aria-label="Codex MCP"
					onclick={() => openPanel(editor.codexOpen ? null : 'codex')}
				>
					<i aria-hidden="true"></i>Codex
				</button>
			</div>

			<button class="primary" disabled={exporting} onclick={runExport}>
				{exporting ? '만드는 중…' : '내보내기'}
			</button>
		</header>
		{#if exportError}
			<div class="stale-bar" role="alert">
				<strong>내보내기 실패</strong><span>{exportError}</span>
				<button onclick={() => (exportError = null)}>닫기</button>
			</div>
		{/if}
		{#if editor.shelfOpen}
			<div class="shelf-drop">
				<BookShelf />
			</div>
			<div
				class="scrim"
				role="button"
				tabindex="-1"
				aria-label="책장 닫기"
				onclick={() => (editor.shelfOpen = false)}
				onkeydown={(e) => e.key === 'Enter' && (editor.shelfOpen = false)}
			></div>
		{/if}
		{#if editor.searchOpen}
			<SearchBar />
		{/if}
		{#if staleTotal}
			<div class="stale-bar" role="alert">
				<strong>원문이 바뀐 번역 {staleTotal}개</strong>
				<span>번역한 뒤 원본의 해당 문단이 달라졌습니다. 정리하기 전까지 내보낼 수 없습니다.</span>
				<button disabled={resolving} onclick={() => void resolve('keep')}>모두 그대로 확정</button>
				<button disabled={resolving} onclick={() => void resolve('discard')}>모두 번역 버리기</button>
			</div>
		{/if}
		<div
			class="body"
			class:nav-open={editor.navOpen}
			class:with-panel={editor.settingsOpen ||
				editor.codexOpen ||
				editor.saveOpen ||
				editor.guideOpen}
		>
			<ChapterNav />
			<main class:editing={editor.view === 'edit'}>
				{#if !editor.chapter}
					<p class="hint">왼쪽 차례에서 챕터를 선택하세요</p>
				{:else if editor.view === 'edit'}
					<div class="colhead">
						<span class="lbl">원문 · EN</span>
						<Segmented
							size="small"
							label="블록 필터"
							value={editor.filter}
							items={FILTERS.map((f) => ({
								key: f.key,
								label: f.label,
								count: f.count(counts),
								disabled: f.key !== 'all' && f.count(counts) === 0
							}))}
							pick={pickFilter}
						/>
						<span class="lbl right">번역 · KO</span>
					</div>
					{#if rows.length === 0}
						<p class="hint">이 필터에 해당하는 블록이 없습니다</p>
					{/if}
					{#each rows as block (block.id)}
						<BlockRow {block} />
					{/each}
				{:else}
					{#key `${editor.chapterId}:${editor.previewRev}`}
						<iframe
							class="preview"
							title="미리보기"
							src="/preview/{editor.chapterId}"
							onload={(e) => {
								// 번역이 도착해 다시 그렸을 때 보던 자리로 되돌린다
								if (editor.previewScroll) {
									(e.currentTarget as HTMLIFrameElement).contentWindow?.scrollTo(
										0,
										editor.previewScroll
									);
								}
							}}
						></iframe>
					{/key}
				{/if}
			</main>
			{#if editor.settingsOpen}
				<SettingsPanel />
			{:else if editor.codexOpen}
				<CodexPanel />
			{:else if editor.saveOpen}
				<SavePanel />
			{:else if editor.guideOpen}
				<GuidePanel />
			{/if}
		</div>
		{#if helpOpen}
			<ShortcutHelp close={() => (helpOpen = false)} />
		{/if}
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
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		min-width: 0;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-align: left;
	}
	.book strong {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.book .caret {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.book:hover .caret {
		color: var(--ink);
	}
	.shelf-drop {
		position: absolute;
		top: 52px;
		left: 1.25rem;
		z-index: 15;
		width: min(560px, calc(100vw - 2.5rem));
		border: 1px solid var(--line);
		box-shadow: 0 20px 50px -22px rgb(0 0 0 / 45%);
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 14;
		cursor: default;
	}
	.app {
		position: relative;
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
	.progress.live .num {
		color: var(--draft);
	}
	.progress.live .spine {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--draft) 14%, transparent);
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
					/* 도구 넷은 한 덩어리로 묶어 주요 행동과 구분한다 */
	.tools {
		display: flex;
		border: 1px solid var(--line);
	}
	.tools .tool {
		border: 0;
	}
	.tools .tool + .tool {
		border-left: 1px solid var(--line);
	}
	.primary {
		border: 1px solid var(--ink);
		background: var(--ink);
		padding: 0.32rem 0.9rem;
		color: var(--paper);
		font-size: 0.8rem;
	}
	.primary:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.tool {
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
		color: var(--muted);
		text-decoration: none;
	}
	.tool {
		border: 1px solid var(--line);
	}
	.tool.on {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.codex,
	.save,
	.guide {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.guide i {
		width: 6px;
		height: 6px;
		border: 1px solid var(--muted);
		border-radius: 50%;
	}
	.guide.set i {
		border-color: var(--draft);
		background: var(--draft);
	}
	.save i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--sealed);
	}
	.save.dirty i {
		background: var(--draft);
	}
	.codex i {
		width: 6px;
		height: 6px;
		border: 1px solid var(--muted);
		border-radius: 50%;
	}
	.codex.on i {
		border-color: var(--sealed);
		background: var(--sealed);
	}
	.codex.running i {
		border-color: var(--draft);
		background: var(--draft);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--draft) 18%, transparent);
	}

	.stale-bar {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-shrink: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--warn) 35%, var(--line));
		background: color-mix(in srgb, var(--warn) 8%, var(--paper));
		padding: 0.55rem 1.25rem;
		font-size: 0.8rem;
	}
	.stale-bar strong {
		color: var(--warn);
	}
	.stale-bar span {
		flex: 1;
		color: var(--muted);
	}
	.stale-bar button {
		border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
		padding: 0.25rem 0.7rem;
		color: var(--warn);
		font-size: 0.76rem;
	}
	.stale-bar button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.body {
		flex: 1;
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 0;
	}
	.body.with-panel {
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
	/* 컬럼 이름 자리를 필터 바로 겸하게 — 세로 공간을 하나 더 쓰지 않는다 */
	.colhead {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: color-mix(in srgb, var(--paper) 92%, transparent);
		backdrop-filter: blur(4px);
		border-bottom: 1px solid var(--line);
		padding: 0.35rem 1.1rem;
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		color: var(--muted);
	}
	.lbl {
		flex: 1;
	}
	.lbl.right {
		text-align: right;
	}
	.hint {
		color: var(--muted);
		padding: 3rem;
		text-align: center;
	}

	/* 좁은 화면: 패널이 본문 2단의 폭을 빼앗지 않도록 위에 띄운다 */
	@media (max-width: 1200px) {
		.body.with-panel {
			grid-template-columns: 240px 1fr;
		}
		.body :global(aside) {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			z-index: 5;
			box-shadow: -12px 0 28px -18px rgb(0 0 0 / 45%);
		}
		.body {
			position: relative;
		}
	}
	/* 더 좁으면 차례를 접는다 */
	@media (max-width: 900px) {
		.body,
		.body.with-panel {
			grid-template-columns: 1fr;
		}
		.body :global(nav) {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			z-index: 6;
			width: 240px;
			box-shadow: 12px 0 28px -18px rgb(0 0 0 / 45%);
		}
		.body:not(.nav-open) :global(nav) {
			display: none;
		}
		.book strong {
			font-size: 0.95rem;
		}
	}
	@media (min-width: 901px) {
		.navtoggle {
			display: none;
		}
	}
	.navtoggle {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--line);
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
