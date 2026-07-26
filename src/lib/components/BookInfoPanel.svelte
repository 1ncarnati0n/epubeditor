<script lang="ts">
	import { editor, saveBookMeta } from '$lib/client/state.svelte';

	const savedTitle = $derived(editor.project?.title ?? '');
	const savedCreator = $derived(editor.project?.creator ?? '');

	let title = $state('');
	let creator = $state('');
	// 마지막으로 서버에서 받아온 값. 타이핑 중인 입력칸을 서버 값이 덮지 않게 하는 기준이다
	let loadedTitle = $state<string | null>(null);
	let loadedCreator = $state<string | null>(null);

	// 패널을 다시 열거나 다른 책을 열면 서버 값으로 맞춘다 (아직 손대지 않았을 때만)
	$effect(() => {
		const untouched = title === (loadedTitle ?? '') && creator === (loadedCreator ?? '');
		if (untouched && (loadedTitle !== savedTitle || loadedCreator !== savedCreator)) {
			title = loadedTitle = savedTitle;
			creator = loadedCreator = savedCreator;
		}
	});

	const dirty = $derived(title !== savedTitle || creator !== savedCreator);
	const valid = $derived(title.trim().length > 0);

	async function apply() {
		await saveBookMeta({ title: title.trim(), creator: creator.trim() || null });
		// 서버가 trim·빈값 폴백을 하므로 그 결과를 그대로 입력칸에 되돌려 놓는다
		title = loadedTitle = editor.project?.title ?? title;
		creator = loadedCreator = editor.project?.creator ?? '';
	}
</script>

<aside class="panel" aria-label="책 정보">
	<div class="head">책 정보</div>

	<p class="lead">
		EPUB의 서지정보입니다. 원본 제목에 판매처 꼬리표가 붙어 있는 책이 흔한데, 여기서 정리하면
		내보낸 EPUB까지 따라옵니다.
	</p>

	<label class="field">
		<span>제목</span>
		<input bind:value={title} spellcheck="false" placeholder="책 제목" />
	</label>

	<label class="field">
		<span>저자</span>
		<input bind:value={creator} spellcheck="false" placeholder="비워두면 저자 항목을 뺍니다" />
	</label>

	<div class="bar">
		<small class:warn={!valid}>{valid ? '' : '제목은 비울 수 없습니다'}</small>
		<button class="primary" disabled={!dirty || !valid} onclick={apply}>
			{dirty ? '저장' : '저장됨'}
		</button>
	</div>

	<section class="where">
		<div class="label">어디에 반영되나</div>
		<ul>
			<li>화면 위쪽 제목과 <strong>책장</strong> 목록</li>
			<li>내려받는 <strong>파일 이름</strong></li>
			<li>내보낸 EPUB의 <code>dc:title</code> · <code>dc:creator</code></li>
		</ul>
		<small>원본 EPUB 파일은 건드리지 않습니다. 이 책에만 적용되고 작업파일에 함께 저장됩니다.</small>
	</section>
</aside>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		width: 320px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
		background: var(--paper-dim);
		padding: 1rem;
	}
	.head {
		margin-bottom: 0.9rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	.lead {
		margin: 0 0 1rem;
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.6;
	}
	.field {
		display: block;
		margin-bottom: 0.9rem;
	}
	.field span {
		display: block;
		margin-bottom: 0.3rem;
		font-size: 0.78rem;
	}
	input {
		width: 100%;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.45rem 0.5rem;
		color: inherit;
		font-family: var(--font-ko);
		font-size: 0.85rem;
	}
	input:focus {
		outline: none;
		border-color: var(--sealed);
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.2rem;
	}
	.bar small {
		flex: 1;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.bar small.warn {
		color: var(--draft);
	}
	.primary {
		border: 1px solid var(--ink);
		background: var(--ink);
		padding: 0.4rem 1.1rem;
		color: var(--paper);
		font-size: 0.8rem;
	}
	.primary:disabled {
		cursor: default;
		border-color: var(--line);
		background: transparent;
		color: var(--muted);
	}
	.where {
		margin-top: 1.3rem;
		border-top: 1px solid var(--line);
		padding-top: 0.9rem;
	}
	.label {
		margin-bottom: 0.5rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
	}
	ul {
		margin: 0;
		padding-left: 1rem;
	}
	li {
		margin-bottom: 0.3rem;
		font-size: 0.76rem;
		line-height: 1.6;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
	}
	.where small {
		display: block;
		margin-top: 0.6rem;
		color: var(--muted);
		font-size: 0.7rem;
		line-height: 1.55;
	}
</style>
