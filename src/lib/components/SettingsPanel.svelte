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

	/** 현재 챕터의 책 원본 본문 크기(px) — 숨은 iframe에서 잰다. 못 재면 null */
	let basePx = $state<number | null>(null);
	const bodyPx = $derived(t?.fontSizePx ?? basePx);

	// 가장 많은 p의 계산된 크기 = 본문 크기. p가 없는 챕터(표지 등)는 body로.
	function measure(e: Event) {
		const doc = (e.currentTarget as HTMLIFrameElement).contentDocument;
		const win = doc?.defaultView;
		if (!doc || !win) return;
		const counts = new Map<number, number>();
		for (const el of Array.from(doc.querySelectorAll('p')).slice(0, 300)) {
			if (!el.textContent?.trim()) continue;
			const px = Math.round(parseFloat(win.getComputedStyle(el).fontSize) * 10) / 10;
			counts.set(px, (counts.get(px) ?? 0) + 1);
		}
		const top = [...counts].sort((a, b) => b[1] - a[1])[0];
		basePx = top ? top[0] : doc.body ? parseFloat(win.getComputedStyle(doc.body).fontSize) : null;
	}

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

		{#if t.bilingual}
			<label class="field sub">
				<span
					>원문 크기 <em
						>본문의 {Math.round(t.sourceScale * 100)}%{bodyPx
							? ` · ${Math.round(bodyPx * t.sourceScale * 10) / 10}px`
							: ''}</em
					></span
				>
				<input
					type="range"
					aria-label="원문 크기 (본문 대비 %)"
					min="40"
					max="100"
					step="5"
					value={Math.round(t.sourceScale * 100)}
					oninput={(e) => saveTypography({ sourceScale: num(e) / 100 })}
				/>
			</label>

			<label class="field sub">
				<span>원문 흐림 <em>{t.sourceOpacity.toFixed(2)}</em></span>
				<input
					type="range"
					min="0.2"
					max="1"
					step="0.05"
					value={t.sourceOpacity}
					oninput={(e) => saveTypography({ sourceOpacity: num(e) })}
				/>
				<small>원문 크기는 본문(번역문) 글자 크기 대비 비율입니다. 작게 할수록 흐리면 안 보이니 같이 조절하세요</small>
			</label>
		{/if}

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

		<div class="field">
			<span
				>글자 크기 <em
					>{#if t.fontSizePx == null}책 원본{basePx ? ` ${basePx}px` : ''}{:else}{t.fontSizePx}px
						<button class="reset" onclick={() => saveTypography({ fontSizePx: null })}>원본</button
						>{/if}</em
				></span
			>
			<input
				type="range"
				aria-label="글자 크기 (px)"
				min="10"
				max="28"
				step="0.5"
				value={t.fontSizePx ?? basePx ?? 16}
				oninput={(e) => saveTypography({ fontSizePx: num(e) })}
			/>
			<small>
				{#if basePx}이 챕터의 책 원본 본문 크기는 {basePx}px입니다{:else}원본 크기를 재는 중…{/if}
			</small>
			{#if editor.chapterId}
				<!-- 원본 크기 측정용: 크기 덮어쓰기를 뺀 미리보기. 챕터가 바뀔 때만 다시 잰다 -->
				{#key editor.chapterId}
					<iframe
						class="probe"
						title="원본 크기 측정"
						aria-hidden="true"
						tabindex="-1"
						src="/preview/{editor.chapterId}?base"
						onload={measure}
					></iframe>
				{/key}
			{/if}
		</div>

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
	/* 위 항목에 딸린 설정 — 들여써서 소속을 보인다 */
	.field.sub {
		margin-left: 0.7rem;
		border-left: 1px solid var(--line);
		padding-left: 0.6rem;
		margin-bottom: 0.8rem;
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
	/* display:none이면 일부 브라우저가 스타일을 계산하지 않는다 — 화면 밖으로만 뺀다 */
	.probe {
		position: absolute;
		left: -10000px;
		width: 600px;
		height: 10px;
		border: 0;
		visibility: hidden;
	}
	.reset {
		margin-left: 0.3rem;
		padding: 0 0.3rem;
		border: 1px solid var(--line);
		font-size: 0.65rem;
		color: var(--muted);
	}
	.note {
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 1.5rem;
	}
</style>
