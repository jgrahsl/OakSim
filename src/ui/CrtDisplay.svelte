<script lang="ts">
	import { onMount } from 'svelte';
	import { crt, keyInput } from '../state';

	const CELL_W = 8;

	// CGA-ish attribute palette (attribute byte low nibble = foreground).
	const PALETTE = [
		'#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa',
		'#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff',
		'#ff5555', '#ff55ff', '#ffff55', '#ffffff',
	];

	let canvas: HTMLCanvasElement;
	let blinkPhase = $state(true);
	let collapsed = $state(
		typeof localStorage !== 'undefined' &&
			localStorage.getItem('oaksim.crtCollapsed') === 'true',
	);

	function toggleCollapsed() {
		collapsed = !collapsed;
		localStorage?.setItem('oaksim.crtCollapsed', String(collapsed));
	}

	// Keystrokes on the focused screen go to the keyboard peripheral.
	function handleKey(event: KeyboardEvent) {
		let code: number | null = null;
		if (event.key.length === 1) {
			code = event.key.charCodeAt(0);
		} else if (event.key === 'Enter') {
			code = 13;
		} else if (event.key === 'Backspace') {
			code = 8;
		} else if (event.key === 'Escape') {
			code = 27;
		}
		if (code !== null && code < 128) {
			keyInput(code);
			event.preventDefault();
		}
	}

	onMount(() => {
		const timer = setInterval(() => {
			blinkPhase = !blinkPhase;
		}, 400);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const view = $crt;
		const phase = blinkPhase;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// While the CRTC is unprogrammed (R1/R6 = 0), keep the canvas at the
		// standard 40x25 geometry so the layout doesn't jump when a program
		// switches the display on.
		let cols = view?.crtc.cols ?? 0;
		let rows = view?.crtc.rows ?? 0;
		let cellH = Math.max(view?.crtc.charHeight ?? 8, 2);
		const off = !view || cols === 0 || rows === 0;
		if (off) {
			cols = 40;
			rows = 25;
			cellH = 8;
		}

		canvas.width = cols * CELL_W;
		canvas.height = rows * cellH;
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		if (off) return;

		ctx.font = `${cellH}px monospace`;
		ctx.textBaseline = 'bottom';
		const cells = view.cells;
		for (let cell = 0; cell * 2 + 1 < cells.length; cell++) {
			const ch = cells[cell * 2];
			if (ch <= 32 || ch >= 127) continue; // blank/non-printable
			const attr = cells[cell * 2 + 1];
			const col = cell % cols;
			const row = Math.floor(cell / cols);
			ctx.fillStyle = PALETTE[attr & 0x0f];
			ctx.fillText(String.fromCharCode(ch), col * CELL_W, (row + 1) * cellH);
		}

		// Cursor: R14/R15 position relative to the display start, shaped by
		// R10/R11, honoring the R10 blink mode.
		const { cursorMode, cursorAddress, startAddress, cursorStartLine, cursorEndLine } =
			view.crtc;
		if (cursorMode === 'off') return;
		if ((cursorMode === 'blink' || cursorMode === 'blink-slow') && !phase) return;
		const cursorCell = cursorAddress - startAddress;
		if (cursorCell < 0 || cursorCell >= cols * rows) return;
		const cursorCol = cursorCell % cols;
		const cursorRow = Math.floor(cursorCell / cols);
		const top = Math.min(cursorStartLine, cellH - 1);
		const bottom = Math.min(cursorEndLine, cellH - 1);
		ctx.fillStyle = '#aaaaaa';
		ctx.fillRect(
			cursorCol * CELL_W,
			cursorRow * cellH + top,
			CELL_W,
			Math.max(bottom - top + 1, 1),
		);
	});
</script>

<div class="panel" id="crt">
	<button class="title" onclick={toggleCollapsed} title="Collapse/expand">
		{collapsed ? '▸' : '▾'} CRT · MC6845 @ 0x70000 · KBD @ 0x70010
		{#if $crt && $crt.crtc.cols > 0}
			· {$crt.crtc.cols}×{$crt.crtc.rows}
		{:else}
			· off (R1/R6 not programmed)
		{/if}
		<span class="hint">click screen to type</span>
	</button>
	<canvas
		bind:this={canvas}
		class:hidden={collapsed}
		tabindex="0"
		onkeydown={handleKey}
	></canvas>
</div>

<style>
	.title {
		background: none;
		border: none;
		color: #505050;
		cursor: pointer;
		display: block;
		font: inherit;
		letter-spacing: inherit;
		margin-bottom: 6px;
		padding: 0;
		text-align: left;
		width: 100%;
	}
	canvas.hidden {
		display: none;
	}
	.hint {
		float: right;
	}
	canvas:focus {
		border-color: #90a959;
		outline: none;
	}
	canvas {
		background: #000;
		border: 1px solid #313032;
		display: block;
		image-rendering: pixelated;
		width: 100%;
	}
</style>
