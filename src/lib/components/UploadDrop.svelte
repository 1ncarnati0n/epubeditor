<script lang="ts">
	import { uploadEpub } from '$lib/client/state.svelte';

	let dragging = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function handle(files: FileList | null | undefined) {
		const file = files?.[0];
		if (!file) return;
		busy = true;
		error = null;
		error = await uploadEpub(file);
		busy = false;
	}
</script>

<div class="wrap">
	<label
		class="drop"
		class:dragging
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			handle(e.dataTransfer?.files);
		}}
	>
		<input
			type="file"
			accept=".epub,application/epub+zip"
			hidden
			onchange={(e) => handle(e.currentTarget.files)}
		/>
		<div class="mark" aria-hidden="true">EN<span>·</span>KO</div>
		{#if busy}
			<p class="lead">책을 여는 중…</p>
		{:else}
			<p class="lead">EPUB을 끌어다 놓거나 클릭해 열기</p>
			<p class="sub">영어 원서를 블록 단위로 나눠 한국어 번역을 준비합니다</p>
		{/if}
		{#if error}<p class="error">{error}</p>{/if}
	</label>
</div>

<style>
	.wrap {
		height: 100vh;
		display: grid;
		place-items: center;
		padding: 2rem;
	}
	.drop {
		width: min(560px, 100%);
		padding: 4rem 2rem;
		border: 1px dashed var(--muted);
		text-align: center;
		cursor: pointer;
		background: var(--paper);
		transition: border-color 0.15s, background 0.15s;
	}
	.drop.dragging,
	.drop:hover {
		border-color: var(--sealed);
		background: var(--fresh);
	}
	.mark {
		font-family: var(--font-en);
		font-size: 2rem;
		letter-spacing: 0.04em;
		margin-bottom: 1.5rem;
	}
	.mark span {
		color: var(--draft);
		margin: 0 0.4rem;
	}
	.lead {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
	}
	.sub {
		color: var(--muted);
		margin: 0;
	}
	.error {
		color: #a33;
		margin: 1rem 0 0;
	}
</style>
