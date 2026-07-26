<script lang="ts">
	import { editor, saveTranslationGuide } from '$lib/client/state.svelte';
	import { defaultTranslationGuide } from '$lib/types';

	const MAX = 4000;
	const saved = $derived(editor.project?.translationGuide ?? '');

	// 새 책이 이미 들고 시작하는 기본 지침 — 지우고 나서 되돌리고 싶을 때 쓴다
	const EXAMPLE = defaultTranslationGuide();

	let draft = $state('');
	let loaded = $state<string | null>(null);

	// 패널을 다시 열거나 다른 책을 열면 서버 값으로 맞춘다 (타이핑 중에는 건드리지 않음)
	$effect(() => {
		if (loaded !== saved && draft === (loaded ?? '')) {
			draft = saved;
			loaded = saved;
		}
	});

	const dirty = $derived(draft !== saved);

	async function apply() {
		const text = draft.slice(0, MAX);
		await saveTranslationGuide(text);
		loaded = text;
	}

	/** 비어 있으면 예문으로 시작하고, 이미 쓴 게 있으면 아래에 덧붙인다 */
	function insertExample() {
		draft = draft.trim() ? `${draft.trimEnd()}\n${EXAMPLE}` : EXAMPLE;
	}
</script>

<aside class="panel" aria-label="번역 지침">
	<div class="head">번역 지침</div>

	<p class="lead">
		이 책을 번역할 때 지킬 규칙. 문체·호칭·고유명사 표기·피할 표현 같은 것을 적습니다. 새 책은 아래
		기본 지침을 들고 시작하니, 고칠 것만 고치면 됩니다.
	</p>

	<textarea
		bind:value={draft}
		maxlength={MAX}
		spellcheck="false"
		placeholder={EXAMPLE}
	></textarea>

	<div class="bar">
		<small class:over={draft.length > MAX * 0.9}>{draft.length}/{MAX}</small>
		<button
			class="example"
			title="아래 예문을 그대로 넣습니다 — 넣고 고쳐 쓰면 됩니다"
			onclick={insertExample}
		>
			{draft.trim() ? '예문 덧붙이기' : '예문 넣기'}
		</button>
		<button class="primary" disabled={!dirty} onclick={apply}>
			{dirty ? '저장' : '저장됨'}
		</button>
	</div>

	<section class="where">
		<div class="label">어디에 적용되나</div>
		<ul>
			<li><strong>Codex</strong> — 번역 요청 프롬프트에 함께 전달</li>
			<li>
				<strong>다른 MCP 클라이언트</strong> (Claude Code 등) — <code>get_blocks</code> 응답의
				<code>translationGuide</code>로 전달
			</li>
		</ul>
		<small>이미 연결된 세션에도 즉시 반영됩니다. 이 책에만 적용되고 작업파일에 함께 저장됩니다.</small>
	</section>
</aside>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		width: 320px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
		background:
			linear-gradient(90deg, color-mix(in srgb, var(--draft) 4%, transparent), transparent 22%),
			var(--paper-dim);
		padding: 1rem;
	}
	.head {
		margin-bottom: 0.9rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	.lead {
		margin: 0 0 0.7rem;
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.6;
	}
	textarea {
		min-height: 15rem;
		flex: 1;
		resize: vertical;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.6rem;
		color: inherit;
		font-family: var(--font-ko);
		font-size: 0.82rem;
		line-height: 1.75;
	}
	textarea:focus {
		outline: none;
		border-color: var(--sealed);
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.bar small {
		flex: 1;
		color: var(--muted);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}
	.example {
		border: 1px solid var(--line);
		padding: 0.4rem 0.7rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.example:hover {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.bar small.over {
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
