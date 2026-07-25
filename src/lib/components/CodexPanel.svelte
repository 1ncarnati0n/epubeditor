<script lang="ts">
	import {
		connectCodex,
		editor,
		saveCodexSettings,
		startCodexTranslation,
		stopCodexTranslation
	} from '$lib/client/state.svelte';
	import type { CodexTranslationScope } from '$lib/types';
	import Segmented from './Segmented.svelte';

	let scope: CodexTranslationScope = $state('chapter');
	let busy = $state(false);
	let notice = $state<string | null>(null);

	const status = $derived(editor.codex);
	const job = $derived(status?.job);
	const running = $derived(job?.state === 'running' || job?.state === 'stopping');
	const settings = $derived(editor.project?.codex);
	const models = $derived(status?.models ?? []);
	/** 추론 강도 선택지는 고른 모델이 실제로 지원하는 것만 */
	const efforts = $derived(models.find((m) => m.slug === settings?.model)?.efforts ?? []);
	const currentChapter = $derived(
		editor.project?.chapters.find((chapter) => chapter.id === editor.chapterId)
	);
	const chapterPending = $derived(currentChapter?.untranslated ?? 0);
	const bookPending = $derived(
		editor.project?.chapters.reduce((sum, chapter) => sum + chapter.untranslated, 0) ?? 0
	);
	const selectedPending = $derived(scope === 'chapter' ? chapterPending : bookPending);
	const batches = $derived(Math.ceil(selectedPending / (settings?.batchSize || 20)));

	function pickModel(slug: string) {
		const model = slug ? models.find((m) => m.slug === slug) : null;
		// 모델을 바꾸면 그 모델이 지원하지 않는 강도는 버린다
		const effort =
			model && settings?.effort && model.efforts.includes(settings.effort) ? settings.effort : null;
		void saveCodexSettings({ model: slug || null, effort });
	}
	const jobPercent = $derived(
		job?.total ? Math.round((job.translated / job.total) * 100) : job?.state === 'completed' ? 100 : 0
	);

	async function act(action: () => Promise<string | null>) {
		busy = true;
		notice = null;
		try {
			notice = await action();
		} catch {
			notice = 'Codex 요청에 실패했습니다';
		} finally {
			busy = false;
		}
	}

	/** 건너뛴 chapter만 다시 — 하나씩 순서대로 (잡은 한 번에 하나만 돈다) */
	async function retryFailed(): Promise<string | null> {
		for (const failed of job?.failedChapters ?? []) {
			const problem = await startCodexTranslation('chapter', failed.id);
			if (problem) return problem;
			// 이 chapter가 끝날 때까지 기다린 뒤 다음으로
			while (editor.codex?.job.state === 'running' || editor.codex?.job.state === 'stopping') {
				await new Promise((r) => setTimeout(r, 800));
			}
			if (editor.codex?.job.state === 'cancelled') return null;
		}
		return null;
	}

	async function copyLogin() {
		await navigator.clipboard.writeText('codex login');
		notice = 'codex login 복사됨';
	}
</script>

<aside class="panel" aria-label="Codex MCP">
	<div class="head">
		<span>CODEX · MCP</span>
		<i
			class:ready={status?.connection === 'connected' && status?.cli === 'ready'}
			class:working={running}
			aria-hidden="true"
		></i>
	</div>

	{#if !status}
		<p class="muted">Codex 상태 확인 중…</p>
	{:else if status.cli === 'missing'}
		<section class="gate">
			<strong>Codex CLI 필요</strong>
			<p>Codex CLI 설치 후 이 panel을 다시 여세요.</p>
			<a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noreferrer"
				>설치 안내 ↗</a
			>
		</section>
	{:else if status.cli === 'logged-out'}
		<section class="gate">
			<strong>Codex 로그인 필요</strong>
			<p>terminal에서 아래 명령을 실행하세요.</p>
			<button class="command" onclick={copyLogin}><code>codex login</code><span>복사</span></button>
		</section>
	{:else if status.connection !== 'connected'}
		<section class="gate">
			<strong>{status.connection === 'stale' ? 'MCP 주소 갱신 필요' : 'MCP 연결 대기'}</strong>
			<p>
				사용자 Codex 설정에 <code>epub-editor</code>를 등록합니다.
			</p>
			{#if status.configuredUrl}
				<small>현재 {status.configuredUrl}</small>
			{/if}
			<button class="primary" disabled={busy} onclick={() => act(connectCodex)}>
				{busy ? '연결 중…' : status.connection === 'stale' ? '다시 연결' : 'MCP 연결'}
			</button>
		</section>
	{:else}
		<div class="connected">
			<span><i aria-hidden="true"></i> 연결됨</span>
			<small>{status.expectedUrl}</small>
		</div>

		{#if running}
			<section class="run" aria-live="polite">
				<div class="run-title">
					<strong>{job?.state === 'stopping' ? '중지 중' : '번역 중'}</strong>
					<span>{jobPercent}%</span>
				</div>
				<progress max={job?.total || 1} value={job?.translated ?? 0}></progress>
				<p>{job?.chapterTitle ?? job?.chapterId}</p>
				<small>
					{#if job?.scope === 'block'}
						block {job.translated}/{job.total}{job.queuedIds.length
							? ` · 대기 ${job.queuedIds.length}`
							: ''}
					{:else}
						chapter {job?.chapterIndex}/{job?.chapterCount} · block {job?.translated}/{job?.total}
					{/if}
				</small>
				<button
					class="stop"
					disabled={busy || job?.state === 'stopping'}
					onclick={() => act(stopCodexTranslation)}
				>
					{job?.state === 'stopping' ? '중지 중…' : '번역 중지'}
				</button>
			</section>
		{:else}
			{#if job && job.state !== 'idle'}
				<div class="result {job.state}" class:skipped={job.failedChapters.length} aria-live="polite">
					<strong>
						{job.failedChapters.length
							? '일부 chapter 건너뜀'
							: job.state === 'completed'
								? '번역 완료'
								: job.state === 'cancelled'
									? '번역 중지됨'
									: '번역 실패'}
					</strong>
					<p>{job.error ?? job.message}</p>
					{#if job.failedChapters.length}
						<ul class="failed">
							{#each job.failedChapters as f (f.id)}
								<li><span>{f.title ?? f.id}</span><small>{f.reason}</small></li>
							{/each}
						</ul>
						<button class="primary" disabled={busy} onclick={() => act(retryFailed)}>
							{busy ? '다시 시도 중…' : '실패한 chapter만 다시 번역'}
						</button>
					{/if}
				</div>
			{/if}

			<section class="scope">
				<div class="label">번역 범위</div>
				<Segmented
					label="번역 범위"
					value={scope}
					items={[
						{ key: 'chapter', label: '현재 chapter' },
						{ key: 'book', label: '책 전체' }
					]}
					pick={(key) => (scope = key as CodexTranslationScope)}
				/>
				<div class="selection">
					{#if scope === 'chapter'}
						<strong>{currentChapter?.title ?? editor.chapterId ?? 'chapter 미선택'}</strong>
					{:else}
						<strong>{editor.project?.title}</strong>
					{/if}
					<span>미번역 {selectedPending} blocks</span>
					<small>{selectedPending ? `약 ${batches}회 Codex batch` : '번역할 block 없음'}</small>
				</div>
				<button
					class="primary start"
					disabled={busy || selectedPending === 0 || (scope === 'chapter' && !editor.chapterId)}
					onclick={() => act(() => startCodexTranslation(scope))}
				>
					{busy ? '시작 중…' : scope === 'chapter' ? '현재 chapter 번역' : '책 전체 번역'}
				</button>
				<p class="note">
					{settings?.batchSize ?? 20} blocks씩 번역. 검수 완료 block은 변경하지 않습니다. 시작 전 스냅샷을
					남깁니다.
				</p>
			</section>
		{/if}

		{#if settings}
			<details class="config">
				<summary>실행 설정</summary>

				<label class="field">
					<span>모델</span>
					{#if models.length}
						<select
							value={settings.model ?? ''}
							disabled={running}
							onchange={(e) => pickModel(e.currentTarget.value)}
						>
							<option value=""
								>Codex 기본값{status?.defaultModel ? ` (${status.defaultModel})` : ''}</option
							>
							{#each models as model (model.slug)}
								<option value={model.slug}>{model.label}</option>
							{/each}
						</select>
					{:else}
						<!-- models_cache.json이 없을 때: slug 직접 입력 -->
						<input
							type="text"
							placeholder={status?.defaultModel ?? 'Codex 기본값'}
							value={settings.model ?? ''}
							disabled={running}
							onchange={(e) => pickModel(e.currentTarget.value.trim())}
						/>
					{/if}
				</label>
				{#if settings.model}
					<small class="hint">{models.find((m) => m.slug === settings.model)?.description ?? ''}</small
					>
				{/if}

				<label class="field">
					<span>추론 강도</span>
					<select
						value={settings.effort ?? ''}
						disabled={running || efforts.length === 0}
						onchange={(e) => saveCodexSettings({ effort: e.currentTarget.value || null })}
					>
						<option value="">모델 기본값</option>
						{#each efforts as effort (effort)}
							<option value={effort}>{effort}</option>
						{/each}
					</select>
				</label>
				{#if efforts.length === 0}
					<small class="hint">모델을 먼저 고르면 강도를 선택할 수 있습니다</small>
				{/if}

				<label class="field">
					<span>배치 크기</span>
					<input
						type="number"
						min="1"
						max="50"
						value={settings.batchSize}
						disabled={running}
						onchange={(e) =>
							saveCodexSettings({
								batchSize: Math.min(50, Math.max(1, Number(e.currentTarget.value) || 20))
							})}
					/>
				</label>

				<small class="hint">
					문체·용어 규칙은 상단 <strong>번역 지침</strong> 패널에서 — Codex와 다른 MCP 클라이언트에 모두
					적용됩니다.
				</small>
			</details>
		{/if}
	{/if}

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
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.1rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.13em;
	}
	.head i {
		width: 8px;
		height: 8px;
		border: 1px solid var(--muted);
		border-radius: 50%;
	}
	.head i.ready {
		border-color: var(--sealed);
		background: var(--sealed);
	}
	.head i.working {
		border-color: var(--draft);
		background: var(--draft);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--draft) 16%, transparent);
		animation: breathe 1.6s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			box-shadow: 0 0 0 7px transparent;
		}
	}
	.gate,
	.scope,
	.run {
		border-top: 1px solid var(--line);
		padding-top: 1rem;
	}
	.gate strong,
	.run strong,
	.result strong {
		font-family: var(--font-en);
		font-size: 1rem;
	}
	.gate p,
	.result p,
	.run p {
		margin: 0.4rem 0 0.8rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.gate a {
		font-size: 0.8rem;
		color: var(--sealed);
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.78rem;
	}
	.command {
		width: 100%;
		display: flex;
		justify-content: space-between;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.55rem 0.65rem;
	}
	.command span {
		color: var(--sealed);
		font-size: 0.72rem;
	}
	.primary,
	.stop {
		width: 100%;
		margin-top: 1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: var(--paper);
		font-size: 0.82rem;
	}
	.primary:disabled,
	.stop:disabled {
		cursor: default;
		opacity: 0.45;
	}
	.connected {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1rem;
	}
	.connected span {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--sealed);
		font-size: 0.78rem;
		font-weight: 700;
	}
	.connected i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--sealed);
	}
	.connected small,
	.gate small {
		color: var(--muted);
		font-size: 0.68rem;
		overflow-wrap: anywhere;
	}
	.label {
		margin-bottom: 0.5rem;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
	}
	.choices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	.choices button {
		padding: 0.45rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.selection {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 1rem 0 0.2rem;
	}
	.selection strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-en);
		font-size: 0.88rem;
	}
	.selection span {
		font-size: 0.8rem;
	}
	.selection small,
	.run small {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.start {
		background: var(--sealed);
		border-color: var(--sealed);
	}
	.note {
		margin: 0.8rem 0 0;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.run-title {
		display: flex;
		justify-content: space-between;
	}
	.run-title span {
		color: var(--draft);
		font-variant-numeric: tabular-nums;
	}
	progress {
		width: 100%;
		height: 5px;
		margin: 0.7rem 0 0;
		border: 0;
		background: var(--line);
		accent-color: var(--draft);
	}
	progress::-webkit-progress-bar {
		background: var(--line);
	}
	progress::-webkit-progress-value {
		background: var(--draft);
	}
	.stop {
		border-color: var(--draft);
		background: transparent;
		color: var(--draft);
	}
	.result {
		margin-bottom: 1rem;
		border-left: 2px solid var(--sealed);
		background: var(--paper);
		padding: 0.65rem 0.75rem;
	}
	.result.failed {
		border-color: var(--warn);
	}
	.result.cancelled {
		border-color: var(--draft);
	}
	.result.skipped {
		border-color: var(--warn);
	}
	.failed {
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
	}
	.failed li {
		border-top: 1px solid var(--line);
		padding: 0.35rem 0;
	}
	.failed span {
		display: block;
		font-size: 0.78rem;
	}
	.failed small {
		color: var(--warn);
		font-size: 0.68rem;
	}
	.result p {
		margin-bottom: 0;
		overflow-wrap: anywhere;
	}
	.config {
		margin-top: 1.2rem;
		border-top: 1px solid var(--line);
		padding-top: 0.8rem;
	}
	.config summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
	}
	.field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.8rem;
		font-size: 0.78rem;
	}
	.field select,
	.field input {
		min-width: 0;
		flex: 1;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0.3rem 0.4rem;
		color: inherit;
		font: inherit;
		font-size: 0.78rem;
	}
	.field :disabled {
		opacity: 0.5;
	}
	.hint {
		display: block;
		margin-top: 0.3rem;
		color: var(--muted);
		font-size: 0.68rem;
		line-height: 1.5;
	}
	.muted,
	.notice {
		color: var(--muted);
		font-size: 0.78rem;
	}
	.notice {
		margin-top: 1rem;
		color: var(--warn);
	}
</style>
