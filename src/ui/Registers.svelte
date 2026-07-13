<script lang="ts">
	import { registers } from '../state';
</script>

<div class="panel" id="registers">
	<table>
		<thead>
			<tr><th>Register</th><th>Value</th></tr>
		</thead>
		<tbody>
			{#each $registers as register (register.name)}
				<tr>
					<td>{register.name}</td>
					<td class:changed={register.changed}>{register.value.toString(16)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	table {
		border-collapse: collapse;
	}
	th {
		text-align: left;
		padding-right: 20px;
	}
	td.changed {
		color: #f4bf75;
	}
</style>
