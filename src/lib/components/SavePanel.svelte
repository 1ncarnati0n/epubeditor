<script lang="ts">
	import {
		createSnapshot,
		download,
		editor,
		importWorkFile,
		restoreSnapshot,
		saveNow
	} from '$lib/client/state.svelte';

	let busy = $state(false);
	let notice = $state<string | null>(null);
	let label = $state('');

	const codexRunning = $derived(
		editor.codex?.job.state === 'running' || editor.codex?.job.state === 'stopping'
	);

	async function act(action: () => Promise<string | null>) {
		busy = true;
		notice = null;
		try {
			notice = await action();
		} catch {
			notice = '요청에 실패했습니다';
		} finally {
			busy = false;
		}
	}

	function when(at: number): string {
		const date = new Date(at);
		return `${date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
	}
</script>

<aside class="panel" aria-label="작업 저장">
	<div class="head"><span>저장 · 되돌리기</span></div>

	<section class="now">
		<strong>{editor.save.dirty ? '저장 대기 중' : '저장됨'}</strong>
		<small>
			{editor.save.savedAt ? `마지막 저장 ${when(editor.save.savedAt)}` : '아직 저장 기록 없음'}
			· 편집은 자동 저장됩니다
		</small>
		<button class="primary" disabled={busy} onclick={() => act(async () => (await saveNow(), null))}>
			지금 저장 <kbd>⌘S</kbd>
		</button>
	</section>

	<section class="file">
		<div class="label">원본</div>
		<small>처음 올린 EPUB 그대로. 앱은 이 파일을 절대 수정하지 않습니다.</small>
		<div class="pair">
			<button class="btn" disabled={busy} onclick={() => act(() => download('/api/source'))}
				>원본 EPUB 내려받기</button
			>
		</div>
	</section>

	<section class="file">
		<div class="label">작업파일</div>
		<small>번역만 담긴 JSON — 원문은 들어 있지 않습니다. 백업하거나 다른 PC에서 이어할 때 씁니다.</small>
		<div class="pair">
			<button class="btn" disabled={busy} onclick={() => act(() => download('/api/project/file'))}
				>내보내기</button
			>
			<label class="btn" class:disabled={busy || codexRunning}>
				불러오기
				<input
					type="file"
					accept=".json,application/json"
					hidden
					disabled={busy || codexRunning}
					onchange={(e) => {
						const file = e.currentTarget.files?.[0];
						e.currentTarget.value = '';
						if (file) void act(() => importWorkFile(file));
					}}
				/>
			</label>
		</div>
	</section>

	<section class="snaps">
		<div class="label">스냅샷</div>
		<div class="pair">
			<input
				type="text"
				placeholder="이름 (선택)"
				maxlength="60"
				bind:value={label}
				disabled={busy || codexRunning}
			/>
			<button
				class="btn"
				disabled={busy || codexRunning}
				onclick={() => act(async () => (await createSnapshot(label), (label = ''), null))}
				>만들기</button
			>
		</div>
		{#if codexRunning}
			<small>Codex 번역 중에는 만들 수 없습니다. 시작 직전 스냅샷은 자동으로 남습니다.</small>
		{/if}

		{#if editor.snapshots.length === 0}
			<p class="empty">아직 스냅샷이 없습니다</p>
		{:else}
			<ul>
				{#each editor.snapshots as snap (snap.id)}
					<li>
						<div class="meta">
							<strong>{snap.label}</strong>
							<small>{when(snap.at)} · {snap.done}/{snap.total} block</small>
						</div>
						<button
							disabled={busy || codexRunning}
							onclick={() => act(() => restoreSnapshot(snap.id))}>되돌리기</button
						>
					</li>
				{/each}
			</ul>
			<small>되돌리기 직전 상태도 자동으로 스냅샷에 남습니다. 최대 20개 보관.</small>
		{/if}
	</section>

	{#if notice}<p class="notice" aria-live="polite">{notice}</p>{/if}
</aside>

<style>
	.panel {
		width: 280px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
		background:
			linear-gradient(90deg, color-mix(in srgb, var(--sealed) 3%, transparent), transparent 22%),
			var(--paper-dim);
		padding: 1rem;
	}
	.head {
		margin-bottom: 1.1rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	section {
		border-top: 1px solid var(--line);
		padding-top: 1rem;
		margin-bottom: 1.1rem;
	}
	.now strong {
		font-family: var(--font-en);
		font-size: 1rem;
	}
	small {
		display: block;
		margin-top: 0.35rem;
		color: var(--muted);
		font-size: 0.7rem;
		line-height: 1.55;
	}
	.label {
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
	}
	.primary {
		width: 100%;
		margin-top: 0.9rem;
		border: 1px solid var(--ink);
		background: var(--ink);
		padding: 0.55rem;
		color: var(--paper);
		font-size: 0.82rem;
	}
	.primary:disabled {
		cursor: default;
		opacity: 0.45;
	}
	kbd {
		margin-left: 0.35rem;
		opacity: 0.6;
		font-family: inherit;
		font-size: 0.72rem;
	}
	.pair {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.7rem;
	}
	.pair input {
		min-width: 0;
		flex: 1;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.35rem 0.45rem;
		color: inherit;
		font: inherit;
		font-size: 0.76rem;
	}
	.btn {
		flex: 1;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.35rem 0.5rem;
		color: var(--muted);
		text-align: center;
		text-decoration: none;
		font-size: 0.76rem;
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--sealed);
		color: var(--sealed);
	}
	.btn.disabled,
	.btn:disabled {
		cursor: default;
		opacity: 0.45;
	}
	ul {
		margin: 0.8rem 0 0.5rem;
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
	.meta {
		min-width: 0;
		flex: 1;
	}
	.meta strong {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		font-weight: 400;
	}
	.meta small {
		margin-top: 0.1rem;
	}
	li button {
		flex-shrink: 0;
		border: 1px solid var(--line);
		padding: 0.25rem 0.5rem;
		color: var(--muted);
		font-size: 0.72rem;
	}
	li button:hover:not(:disabled) {
		border-color: var(--draft);
		color: var(--draft);
	}
	li button:disabled {
		cursor: default;
		opacity: 0.45;
	}
	.empty {
		margin: 0.8rem 0 0;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.notice {
		margin-top: 1rem;
		color: #9d3f32;
		font-size: 0.78rem;
	}
</style>
