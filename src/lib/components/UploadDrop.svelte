<script lang="ts">
	// 책이 없을 때의 첫 화면 = 책장. 하던 작업이 있으면 목록에서 바로 이어갈 수 있다.
	import BookShelf from './BookShelf.svelte';
</script>

<div class="wrap">
	<BookShelf mode="standalone" />
	<p class="sub">영어 원서를 블록 단위로 나눠 한국어 번역을 준비합니다</p>
</div>

<style>
	.wrap {
		height: 100vh;
		display: grid;
		place-content: center;
		gap: 1rem;
		padding: 2rem;
		width: 100%;
	}
	.sub {
		margin: 0;
		color: var(--muted);
		font-size: 0.8rem;
		text-align: center;
	}
</style>
