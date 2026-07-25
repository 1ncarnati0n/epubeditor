<script lang="ts">
	import { editor, saveTypography, setDensity, type Density } from '$lib/client/state.svelte';

	const t = $derived(editor.project?.typography);

	function num(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}
</script>

{#if t}
	<aside class="panel" aria-label="조판">
		<div class="head">조판</div>

		<div class="field">
			<span>출력 형식</span>
			<div class="choices" role="group" aria-label="출력 형식">
				<button
					class:on={!t.bilingual}
					aria-pressed={!t.bilingual}
					onclick={() => saveTypography({ bilingual: false })}>번역만</button
				>
				<button
					class:on={t.bilingual}
					aria-pressed={t.bilingual}
					onclick={() => saveTypography({ bilingual: true })}>원문 병기</button
				>
			</div>
			<small>{t.bilingual ? '번역문 아래에 원문을 작게 병기합니다' : '원문을 번역문으로 대체합니다'}</small>
		</div>

		<div class="field">
			<span>편집 화면 밀도</span>
			<div class="choices three" role="group" aria-label="편집 화면 밀도">
				{#each [['tight', '좁게'], ['normal', '보통'], ['loose', '넓게']] as [key, label] (key)}
					<button
						class:on={editor.density === key}
						aria-pressed={editor.density === key}
						onclick={() => setDensity(key as Density)}>{label}</button
					>
				{/each}
			</div>
			<small>이 브라우저에만 저장됩니다 (내보내기와 무관)</small>
		</div>

		<label class="field">
			<span>본문 폰트</span>
			<select
				value={t.bodyFont ?? ''}
				onchange={(e) =>
					saveTypography({
						bodyFont: (e.currentTarget.value || null) as typeof t.bodyFont
					})}
			>
				<option value="">원본 유지</option>
				<option value="pretendard">Pretendard (고딕)</option>
				<option value="noto-serif-kr">Noto Serif KR (명조)</option>
			</select>
		</label>

		<label class="field">
			<span>글자 크기 <em>{t.fontSizePercent}%</em></span>
			<input
				type="range"
				min="70"
				max="150"
				step="5"
				value={t.fontSizePercent}
				oninput={(e) => saveTypography({ fontSizePercent: num(e) })}
			/>
		</label>

		<label class="field">
			<span>행간 <em>{t.lineHeight.toFixed(2)}</em></span>
			<input
				type="range"
				min="1.3"
				max="2.4"
				step="0.05"
				value={t.lineHeight}
				oninput={(e) => saveTypography({ lineHeight: num(e) })}
			/>
		</label>

		<label class="field">
			<span>문단 간격 <em>{t.paraSpacingEm.toFixed(1)}em</em></span>
			<input
				type="range"
				min="0"
				max="1.5"
				step="0.1"
				value={t.paraSpacingEm}
				oninput={(e) => saveTypography({ paraSpacingEm: num(e) })}
			/>
		</label>

		<label class="field">
			<span>들여쓰기 <em>{t.textIndentEm.toFixed(1)}em</em></span>
			<input
				type="range"
				min="0"
				max="2"
				step="0.5"
				value={t.textIndentEm}
				oninput={(e) => saveTypography({ textIndentEm: num(e) })}
			/>
		</label>

		<label class="field">
			<span>좌우 여백 <em>{t.marginPercent}%</em></span>
			<input
				type="range"
				min="0"
				max="15"
				step="1"
				value={t.marginPercent}
				oninput={(e) => saveTypography({ marginPercent: num(e) })}
			/>
		</label>

		<p class="note">미리보기와 내보내기 EPUB에 동일하게 적용됩니다</p>
	</aside>
{/if}

<style>
	.panel {
		border-left: 1px solid var(--line);
		background: var(--paper-dim);
		padding: 1rem;
		width: 220px;
		overflow-y: auto;
	}
	.head {
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	.field {
		display: block;
		margin-bottom: 1.1rem;
	}
	.field span {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		margin-bottom: 0.3rem;
	}
	.field em {
		font-style: normal;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	select,
	input[type='range'] {
		width: 100%;
		accent-color: var(--sealed);
	}
	select {
		font: inherit;
		padding: 0.3rem;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	.choices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	.choices.three {
		grid-template-columns: repeat(3, 1fr);
	}
	.choices button {
		padding: 0.35rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.choices button + button {
		border-left: 1px solid var(--line);
	}
	.choices button.on {
		background: var(--sealed);
		color: white;
	}
	.field small {
		display: block;
		margin-top: 0.35rem;
		color: var(--muted);
		font-size: 0.68rem;
		line-height: 1.5;
	}
	.note {
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 1.5rem;
	}
</style>
