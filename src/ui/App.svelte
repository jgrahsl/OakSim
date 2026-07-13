<script lang="ts">
	import Toolbar from './Toolbar.svelte';
	import Editor from './Editor.svelte';
	import Console from './Console.svelte';
	import CrtDisplay from './CrtDisplay.svelte';
	import Registers from './Registers.svelte';
	import HexPane from './HexPane.svelte';
	import {
		DEFAULT_PROGRAM,
		sourceChanged,
		memory,
		stack,
		data,
		pcLine,
	} from '../state';
</script>

<div id="content">
	<header class="panel" id="header">OakSim</header>
	<div id="main">
		<div class="content-left">
			<Toolbar />
			<div class="panel" id="code">
				<Editor
					value={DEFAULT_PROGRAM}
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
	<footer class="panel" id="footer">&copy; 2017</footer>
</div>
