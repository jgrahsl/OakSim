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
		type ProgramSlot,
	} from '../state';

	let editor: Editor | undefined;

	function handleSelectSlot(slot: ProgramSlot): void {
		editor?.setContent(selectSlot(slot));
	}
</script>

<div id="content">
	<header class="panel" id="header">OakSim</header>
	<div id="main">
		<div class="content-left">
			<Toolbar onselectslot={handleSelectSlot} />
			<div class="panel" id="code">
				<Editor
					bind:this={editor}
					value={currentProgram()}
					onchange={sourceChanged}
					pcLine={$pcLine}
				/>
			</div>
			<Console />
		</div>
		<div class="content-right">
			<div id="top-right">
				<CrtDisplay />
				<Registers />
			</div>
			<HexPane id="memory" title="Code · PC underlined" rows={$memory} />
			<HexPane id="stack" title="Stack top · SP underlined" rows={$stack} />
			<HexPane id="data" title="Data · WRAM @ 0x40000" rows={$data} />
		</div>
	</div>
	<HexPane
		id="vram"
		title="Character memory · VRAM @ 0x60000 · cursor underlined"
		rows={$vram}
	/>
	<footer class="panel" id="footer">&copy; 2017</footer>
</div>
