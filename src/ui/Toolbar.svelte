<script lang="ts">
	import { running, step, toggleRun, reset } from '../state';

	let delay = $state(250);
</script>

<div class="panel" id="buttons">
	<button disabled>Open</button>
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
</div>

<style>
	input {
		width: 50px;
	}
</style>
