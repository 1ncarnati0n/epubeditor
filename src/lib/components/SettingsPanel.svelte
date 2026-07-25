<script lang="ts">
	import { editor, saveTypography, setDensity, type Density } from '$lib/client/state.svelte';
	import Segmented from './Segmented.svelte';

	const t = $derived(editor.project?.typography);

	const COLORS: { value: string | null; label: string }[] = [
		{ value: null, label: '책 원본 그대로' },
		{ value: '#1c1b18', label: '먹 (가장 진하게)' },
		{ value: '#33312c', label: '진한 회갈' },
		{ value: '#55524a', label: '부드럽게' }
	];

	function num(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}
</script>

{#if t}
	<aside class="panel" aria-label="조판">
		<div class="head">조판</div>

		<div class="field">
			<span>출력 형식</span>
			<Segmented
				label="출력 형식"
				value={t.bilingual ? 'both' : 'ko'}
				items={[
					{ key: 'ko', label: '번역만' },
					{ key: 'both', label: '원문 병기' }
				]}
				pick={(key) => saveTypography({ bilingual: key === 'both' })}
			/>
			<small>{t.bilingual ? '번역문 아래에 원문을 작게 병기합니다' : '원문을 번역문으로 대체합니다'}</small>
		</div>

		<div class="field">
			<span>편집 화면 밀도</span>
			<Segmented
				label="편집 화면 밀도"
				value={editor.density}
				items={[
					{ key: 'tight', label: '좁게' },
					{ key: 'normal', label: '보통' },
					{ key: 'loose', label: '넓게' }
				]}
				pick={(key) => setDensity(key as Density)}
			/>
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

		<div class="field">
			<span>본문 색</span>
			<div class="swatches">
				{#each COLORS as c (c.value ?? 'keep')}
					<button
						class:on={t.textColor === c.value}
						title={c.label}
						aria-label={c.label}
						aria-pressed={t.textColor === c.value}
						style:background={c.value ?? 'transparent'}
						onclick={() => saveTypography({ textColor: c.value })}
					>
						{#if c.value === null}원본{/if}
					</button>
				{/each}
				<input
					type="color"
					title="직접 고르기"
					aria-label="본문 색 직접 고르기"
					value={t.textColor ?? '#1c1b18'}
					oninput={(e) => saveTypography({ textColor: e.currentTarget.value })}
				/>
			</div>
			<small>
				{t.textColor
					? '책 원본 색을 무시하고 이 색으로 칠합니다 (링크 제외)'
					: '책이 정한 색을 그대로 씁니다'}
			</small>
		</div>

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
	.swatches {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.swatches button {
		width: 26px;
		height: 26px;
		border: 1px solid var(--line);
		font-size: 0.6rem;
		color: var(--muted);
	}
	.swatches button.on {
		outline: 2px solid var(--sealed);
		outline-offset: 1px;
	}
	.swatches input[type='color'] {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--line);
		background: var(--paper);
		cursor: pointer;
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
