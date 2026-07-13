<script lang="ts">
	import {
		running,
		step,
		toggleRun,
		reset,
		activeSlot,
		SLOT_COUNT,
		type ProgramSlot,
	} from '../state';

	let {
		onselectslot,
	}: { onselectslot: (slot: ProgramSlot) => void } = $props();

	let delay = $state(250);
</script>

<div class="panel" id="buttons">
	<button class:active={$running} onclick={() => toggleRun(delay)}>Run</button>
	<input
		type="number"
		bind:value={delay}
		min={0}
		title="ms per step while running; 0 = full speed"
		readonly={$running}
	/>
	<button disabled={$running} onclick={() => step()}>Step</button>
	<button onclick={() => reset()}>Reset</button>
	<span class="separator"></span>
	<button
		class:active={$activeSlot === 'default'}
		title="Built-in 6845 demo (read-only; edits are not saved)"
		onclick={() => onselectslot('default')}
	>
		Default
	</button>
	{#each Array(SLOT_COUNT) as _, slot (slot)}
		<button
			class:active={$activeSlot === slot}
			title={`Program slot ${slot} (autosaved in your browser)`}
			onclick={() => onselectslot(slot)}
		>
			Pgm {slot}
		</button>
	{/each}
</div>

<style>
	input {
		width: 50px;
	}
	.separator {
		border-left: 1px dashed #313032;
		display: inline-block;
		height: 1.8em;
		margin: 0 6px;
		vertical-align: middle;
	}
	button.active {
		border-color: white;
	}
</style>
