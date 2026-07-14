<script lang="ts">
	import type { DumpRow } from '../core/hexdump';

	export interface LegendItem {
		label: string;
		kind: 'pc' | 'sp' | 'fp' | 'spfp' | 'cursor' | 'changed';
	}

	/** Swatch colors matching the byte-mark styles below. */
	const SWATCH: Record<LegendItem['kind'], string> = {
		pc: '#f4bf75', // yellow is reserved for the PC across the UI
		sp: '#6a9fb5',
		fp: '#d28445',
		spfp: '#aa759f',
		cursor: '#e0e0e0',
		changed: '#90a959',
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
	.changed {
		background: rgba(144, 169, 89, 0.45);
		border-radius: 2px;
	}
	/* Per-kind marker highlights (see the legend swatches above): solid
	   backgrounds with dark text for contrast; the inline per-byte value
	   color must be overridden, hence !important. Declared after
	   .changed so a marked-and-changed byte shows the marker. */
	.hex.mark-pc {
		background: #f4bf75;
		border-radius: 2px;
		color: #0e0e0e !important;
	}
	.hex.mark-sp {
		background: #6a9fb5;
		border-radius: 2px;
		color: #0e0e0e !important;
	}
	.hex.mark-fp {
		background: #d28445;
		border-radius: 2px;
		color: #0e0e0e !important;
	}
	/* SP and FP on the same word. */
	.hex.mark-sp.mark-fp {
		background: #aa759f;
	}
	.hex.mark-cursor {
		background: #e0e0e0;
		border-radius: 2px;
		color: #0e0e0e !important;
	}
	.ascii {
		margin-left: 1ch;
	}
</style>
