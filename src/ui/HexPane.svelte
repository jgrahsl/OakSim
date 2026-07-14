<script lang="ts">
	import type { DumpRow } from '../core/hexdump';

	let {
		id,
		title,
		rows,
	}: { id: string; title?: string; rows: DumpRow[] } = $props();
</script>

<div class="panel" {id}>
	{#if title}
		<div class="title">{title}</div>
	{/if}
	{#each rows as row (row.offset)}
		<div class="row">
			<span class="offset">{row.offset}:</span>
			{#each row.bytes as byte, i (i)}
				<span
					class="hex"
					class:marked={byte.markers.length > 0}
					class:mark-sp={byte.markers.includes('sp')}
					class:mark-fp={byte.markers.includes('fp')}
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
	.row {
		white-space: nowrap;
	}
	.hex {
		margin-left: 1ch;
	}
	.hex.marked {
		text-decoration: underline;
	}
	/* Pointer-specific highlights (stack pane: SP blue, FP orange). */
	.hex.mark-sp {
		background: rgba(106, 159, 181, 0.3);
		text-decoration-color: #6a9fb5;
	}
	.hex.mark-fp {
		background: rgba(210, 132, 69, 0.3);
		text-decoration-color: #d28445;
	}
	/* SP and FP on the same word. */
	.hex.mark-sp.mark-fp {
		background: rgba(170, 117, 159, 0.4);
		text-decoration-color: #aa759f;
	}
	.changed {
		background: rgba(244, 191, 117, 0.28);
		border-radius: 2px;
	}
	.ascii {
		margin-left: 1ch;
	}
</style>
