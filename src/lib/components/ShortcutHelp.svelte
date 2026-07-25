<script lang="ts">
	let { close }: { close: () => void } = $props();

	const KEYS = [
		['↑ ↓ · J K', '블록 이동'],
		['Enter', '번역 칸 편집 시작'],
		['Esc', '편집 끝내기 (저장됨)'],
		['⌘ Enter', '검수 완료 + 다음 초벌로'],
		['T', '이 블록 Codex로 번역'],
		['⌘ F', '책 전체에서 찾기'],
		['⌘ S', '지금 저장'],
		['?', '이 도움말']
	];
</script>

<div
	class="scrim"
	role="button"
	tabindex="-1"
	aria-label="닫기"
	onclick={close}
	onkeydown={(e) => e.key === 'Enter' && close()}
></div>
<div class="card" role="dialog" aria-modal="true" aria-label="단축키">
	<div class="head">단축키</div>
	<dl>
		{#each KEYS as [key, what] (key)}
			<dt><kbd>{key}</kbd></dt>
			<dd>{what}</dd>
		{/each}
	</dl>
	<p>글을 치는 중에는 한 글자 단축키가 동작하지 않습니다.</p>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: rgb(28 27 24 / 22%);
		cursor: default;
	}
	.card {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 21;
		transform: translate(-50%, -50%);
		width: min(28rem, calc(100vw - 3rem));
		border: 1px solid var(--line);
		background: var(--paper);
		box-shadow: 0 24px 60px -24px rgb(0 0 0 / 40%);
		padding: 1.2rem 1.4rem 1rem;
	}
	.head {
		margin-bottom: 0.9rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.45rem 1rem;
		margin: 0;
		align-items: baseline;
	}
	dt {
		text-align: right;
	}
	kbd {
		border: 1px solid var(--line);
		background: var(--paper-dim);
		padding: 0.1rem 0.4rem;
		font-family: inherit;
		font-size: 0.76rem;
		white-space: nowrap;
	}
	dd {
		margin: 0;
		font-size: 0.84rem;
	}
	p {
		margin: 1rem 0 0;
		color: var(--muted);
		font-size: 0.72rem;
	}
</style>
