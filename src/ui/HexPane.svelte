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
					class:marked={byte.marked}
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
	.changed {
		background: rgba(244, 191, 117, 0.28);
		border-radius: 2px;
	}
	.ascii {
		margin-left: 1ch;
	}
</style>
