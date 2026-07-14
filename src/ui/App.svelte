<script lang="ts">
	import Toolbar from './Toolbar.svelte';
	import Editor from './Editor.svelte';
	import Console from './Console.svelte';
	import CrtDisplay from './CrtDisplay.svelte';
	import Registers from './Registers.svelte';
	import HexPane from './HexPane.svelte';
	import {
		currentProgram,
		selectSlot,
		sourceChanged,
		memory,
		stack,
		data,
		vram,
		pcLine,
		errorLine,
		type ProgramSlot,
	} from '../state';

	let editor: Editor | undefined;

	function handleSelectSlot(slot: ProgramSlot): void {
		editor?.setContent(selectSlot(slot));
	}
</script>

<div id="content">
	<div id="main">
		<div class="content-left">
			<Toolbar onselectslot={handleSelectSlot} />
			<div class="panel" id="code">
				<Editor
					bind:this={editor}
					value={currentProgram()}
					onchange={sourceChanged}
					pcLine={$pcLine}
					errorLine={$errorLine}
				/>
			</div>
			<Console />
		</div>
		<div class="content-right">
			<div id="top-right">
				<CrtDisplay />
				<Registers />
			</div>
			<HexPane
				id="stack"
				title="Stack top"
				rows={$stack}
				legend={[
					{ label: 'SP', kind: 'sp' },
					{ label: 'FP', kind: 'fp' },
					{ label: 'SP=FP', kind: 'spfp' },
					{ label: 'LR', kind: 'lr' },
					{ label: 'frame', kind: 'frame' },
					{ label: 'changed', kind: 'changed' },
				]}
			/>
			<HexPane
				id="memory"
				title="Code"
				rows={$memory}
				legend={[{ label: 'PC', kind: 'pc' }]}
			/>
			<HexPane
				id="data"
				title="Data · WRAM @ 0x40000"
				rows={$data}
				legend={[{ label: 'changed', kind: 'changed' }]}
			/>
		</div>
	</div>
	<HexPane
		id="vram"
		title="Character memory · VRAM @ 0x60000"
		rows={$vram}
		legend={[
			{ label: 'cursor', kind: 'cursor' },
			{ label: 'changed', kind: 'changed' },
		]}
	/>
</div>
