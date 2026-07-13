<script lang="ts">
	import { messages, assembleError } from '../state';
</script>

<div class="panel" id="messages">
	{#if $assembleError}
		<div class="error">{$assembleError}</div>
	{/if}
	{#each $messages as message, i (i)}
		<div>{message}</div>
	{/each}
</div>

<style>
	.error {
		color: #ac4142;
	}
</style>
