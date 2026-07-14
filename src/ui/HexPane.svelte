<script lang="ts">
	import type { DumpRow } from '../core/hexdump';

	export interface LegendItem {
		label: string;
		kind: 'pc' | 'sp' | 'fp' | 'spfp' | 'cursor' | 'changed';
	}

	/** Swatch colors matching the byte-mark styles below. */
	const SWATCH: Record<LegendItem['kind'], string> = {
		pc: '#6a9fb5',
		sp: '#6a9fb5',
		fp: '#d28445',
		spfp: '#aa759f',
		cursor: '#e0e0e0',
		changed: '#f4bf75',
	};

	let {
		id,
		title,
		rows,
		legend = [],
	}: {
		id: string;
		title?: string;
		rows: DumpRow[];
		legend?: LegendItem[];
	} = $props();
</script>

<div class="panel" {id}>
	{#if title}
		<div class="title">
			{title}
			<span class="legend">
				{#each legend as item (item.kind)}
					<span class="chip">
						<span class="swatch" style="background:{SWATCH[item.kind]}"></span>{item.label}
					</span>
				{/each}
			</span>
		</div>
	{/if}
	{#each rows as row (row.offset)}
		<div class="row">
			<span class="offset">{row.offset}:</span>
			{#each row.bytes as byte, i (i)}
				<span
					class="hex"
					class:mark-pc={byte.markers.includes('pc')}
					class:mark-sp={byte.markers.includes('sp')}
					class:mark-fp={byte.markers.includes('fp')}
					class:mark-cursor={byte.markers.includes('cursor')}
					class:changed={byte.changed}
					style="color:{byte.color}"
				>
					{byte.hex}
				</span>
			{/each}
			<span class="ascii">
				{#each row.bytes as byte, i (i)}
					<span class:changed={byte.changed} style="color:{byte.color}"
						>{byte.ascii}</span
					>
				{/each}
			</span>
		</div>
	{/each}
</div>

<style>
	.title {
		color: #505050;
		margin-bottom: 6px;
	}
	.legend {
		float: right;
	}
	.chip {
		margin-left: 12px;
	}
	.swatch {
		border-radius: 2px;
		display: inline-block;
		height: 8px;
		margin-right: 4px;
		width: 8px;
	}
	.row {
		white-space: nowrap;
	}
	.hex {
		margin-left: 1ch;
	}
	/* Per-kind marker highlights (see the legend swatches above). */
	.hex.mark-pc {
		background: rgba(106, 159, 181, 0.35);
		border-radius: 2px;
	}
	.hex.mark-sp {
		background: rgba(106, 159, 181, 0.3);
		text-decoration: underline;
		text-decoration-color: #6a9fb5;
	}
	.hex.mark-fp {
		background: rgba(210, 132, 69, 0.3);
		text-decoration: underline;
		text-decoration-color: #d28445;
	}
	/* SP and FP on the same word. */
	.hex.mark-sp.mark-fp {
		background: rgba(170, 117, 159, 0.4);
		text-decoration-color: #aa759f;
	}
	.hex.mark-cursor {
		background: rgba(224, 224, 224, 0.15);
		text-decoration: underline;
		text-decoration-color: #e0e0e0;
	}
	.changed {
		background: rgba(244, 191, 117, 0.28);
		border-radius: 2px;
	}
	.ascii {
		margin-left: 1ch;
	}
</style>
