<script lang="ts" generics="T extends string">
	// 화면 곳곳의 토글(출력 형식·밀도·필터·검색 범위·보기 전환)이 각자 같은 CSS를 갖고 있던 것을 하나로.
	type Item = { key: T; label: string; count?: number; disabled?: boolean };
	let {
		items,
		value,
		pick,
		label,
		size = 'normal'
	}: {
		items: Item[];
		value: T;
		pick: (key: T) => void;
		label: string;
		size?: 'normal' | 'small';
	} = $props();
</script>

<div class="seg" class:small={size === 'small'} role="group" aria-label={label}>
	{#each items as item (item.key)}
		<button
			class:on={value === item.key}
			aria-pressed={value === item.key}
			disabled={item.disabled}
			onclick={() => pick(item.key)}
		>
			{item.label}{#if item.count !== undefined}<em>{item.count}</em>{/if}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: flex;
		flex-shrink: 0;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		flex: 1;
		padding: 0.35rem 0.6rem;
		color: var(--muted);
		font-size: 0.76rem;
		white-space: nowrap;
	}
	.seg.small button {
		padding: 0.2rem 0.55rem;
		font-size: 0.74rem;
	}
	button + button {
		border-left: 1px solid var(--line);
	}
	button.on {
		background: var(--ink);
		color: var(--paper);
	}
	button:disabled {
		cursor: default;
		opacity: 0.4;
	}
	em {
		font-style: normal;
		font-variant-numeric: tabular-nums;
		opacity: 0.65;
	}
</style>
