<script lang="ts">
	import {
		editor,
		refreshBooks,
		removeBook,
		switchBook,
		uploadEpub
	} from '$lib/client/state.svelte';

	/** standalone = 책이 없을 때의 첫 화면, dropdown = 헤더 제목에서 내려온 목록 */
	let { mode = 'dropdown' }: { mode?: 'dropdown' | 'standalone' } = $props();

	let busy = $state(false);
	let notice = $state<string | null>(null);
	let confirming = $state<string | null>(null);

	$effect(() => {
		void refreshBooks();
	});

	async function act(action: () => Promise<string | null>) {
		busy = true;
		notice = null;
		try {
			notice = await action();
		} finally {
			busy = false;
		}
	}

	async function handleFile(files: FileList | null | undefined) {
		const file = files?.[0];
		if (!file) return;
		busy = true;
		notice = null;
		notice = await uploadEpub(file);
		editor.shelfOpen = false;
		busy = false;
		void refreshBooks();
	}

	function when(at: number): string {
		const days = Math.floor((Date.now() - at) / 86_400_000);
		if (days >= 1) return `${days}일 전`;
		const date = new Date(at);
		return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
	}

	const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
</script>

<div class="shelf" class:standalone={mode === 'standalone'}>
	{#if mode === 'standalone'}
		<div class="mark" aria-hidden="true">EN<span>·</span>KO</div>
	{/if}

	{#if editor.books.length}
		<div class="label">{mode === 'standalone' ? '하던 번역' : '책장'}</div>
		<ul>
			{#each editor.books as book (book.bookId)}
				{@const done = book.machine + book.reviewed}
				<li class:active={book.active}>
					<button
						class="pick"
						disabled={busy || book.active}
						onclick={() => act(() => switchBook(book.bookId))}
					>
						<span class="title">{book.title}</span>
						<span class="meta">
							{#if book.creator}{book.creator} · {/if}
							{#if book.total}{done}/{book.total} block{:else}번역 {done} block{/if}
							{#if book.reviewed}· 검수 {book.reviewed}{/if}
							{#if book.stale}· <b>확인 {book.stale}</b>{/if}
							· {when(book.updatedAt)} · {mb(book.bytes)}
						</span>
						{#if book.total}
							<span class="bar" aria-hidden="true">
								<i class="rev" style:width="{(book.reviewed / book.total) * 100}%"></i>
								<i class="mac" style:width="{(book.machine / book.total) * 100}%"></i>
							</span>
						{/if}
					</button>
					{#if book.active}
						<span class="now">보는 중</span>
					{:else if confirming === book.bookId}
						<button
							class="del yes"
							disabled={busy}
							onclick={() => act(async () => ((confirming = null), removeBook(book.bookId)))}
							>정말 지우기</button
						>
						<button class="del" onclick={() => (confirming = null)}>취소</button>
					{:else}
						<button class="del" title="이 책의 번역까지 지웁니다" onclick={() => (confirming = book.bookId)}
							>지우기</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<label class="open" class:busy>
		<span>{busy ? '여는 중…' : editor.books.length ? '다른 EPUB·PDF 열기' : 'EPUB·PDF를 끌어다 놓거나 눌러서 열기'}</span>
		<input
			type="file"
			accept=".epub,application/epub+zip,.pdf,application/pdf"
			hidden
			disabled={busy}
			onchange={(e) => handleFile(e.currentTarget.files)}
		/>
	</label>

	{#if notice}<p class="notice">{notice}</p>{/if}
	{#if editor.loadError}<p class="notice">{editor.loadError}</p>{/if}
</div>

<style>
	.shelf {
		background: var(--paper);
		padding: 0.9rem 1.1rem 1rem;
	}
	.shelf.standalone {
		width: min(620px, 100%);
		margin: 0 auto;
		border: 1px solid var(--line);
		padding: 2.5rem 2rem 2rem;
	}
	.mark {
		margin-bottom: 1.6rem;
		color: var(--muted);
		font-family: var(--font-en);
		font-size: 1.5rem;
		letter-spacing: 0.1em;
		text-align: center;
	}
	.mark span {
		margin: 0 0.35rem;
		opacity: 0.5;
	}
	.label {
		margin-bottom: 0.6rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	ul {
		max-height: 50vh;
		overflow-y: auto;
		margin: 0 0 0.9rem;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-top: 1px solid var(--line);
		padding: 0.5rem 0;
	}
	li.active {
		background: color-mix(in srgb, var(--sealed) 4%, transparent);
	}
	.pick {
		min-width: 0;
		flex: 1;
		text-align: left;
	}
	.pick:disabled {
		cursor: default;
	}
	.title {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-en);
		font-size: 0.95rem;
	}
	.meta {
		display: block;
		margin-top: 0.1rem;
		color: var(--muted);
		font-size: 0.72rem;
	}
	.meta b {
		font-weight: 400;
		color: var(--warn);
	}
	.bar {
		display: flex;
		height: 2px;
		margin-top: 0.35rem;
		background: var(--line);
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
	.now {
		flex-shrink: 0;
		color: var(--sealed);
		font-size: 0.7rem;
	}
	.del {
		flex-shrink: 0;
		border: 1px solid var(--line);
		padding: 0.2rem 0.5rem;
		color: var(--muted);
		font-size: 0.72rem;
	}
	.del:hover {
		border-color: var(--warn);
		color: var(--warn);
	}
	.del.yes {
		border-color: var(--warn);
		color: var(--warn);
	}
	.open {
		display: block;
		border: 1px dashed var(--line);
		padding: 0.7rem;
		color: var(--muted);
		font-size: 0.82rem;
		text-align: center;
		cursor: pointer;
	}
	.open:hover {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.shelf.standalone .open {
		padding: 2rem;
	}
	.notice {
		margin: 0.7rem 0 0;
		color: var(--warn);
		font-size: 0.78rem;
	}
</style>
