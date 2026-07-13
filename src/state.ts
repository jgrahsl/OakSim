/**
 * Application state: owns the Machine/Assembler instances and exposes
 * Svelte stores plus the actions the UI calls. Components never touch
 * the core directly.
 */
import { writable, readonly } from 'svelte/store';
import { Assembler } from './core/assembler';
import {
	Machine,
	MEMORY_MAP,
	MAX_STRAIGHT_RUN,
	UDF_WORD,
	longestStraightRun,
} from './core/machine';
import { hexdump, type DumpRow } from './core/hexdump';
import { buildLineMap, lineAt, type LineRange } from './core/linemap';
import { Mc6845, type CrtcSnapshot } from './peripherals/mc6845';
import type { RegisterSnapshot } from './core/types';

export const DEFAULT_PROGRAM = `@ --- MC6845 CRT demo --------------------------------------------
@ Programs the CRT controller (registers via the MMIO address/data
@ pair at 0x70000), then writes "hello world" into video memory at
@ row 5, column 5, and leaves a blinking cursor after the text.

	ldr	r0, =0x70000		@ CRTC: +0 address reg, +4 data reg
	ldr	r1, =CrtcTable
InitLoop:
	ldrb	r2, [r1], #1		@ register index (0xFF = end of table)
	cmp	r2, #0xFF
	beq	WriteText
	str	r2, [r0]		@ select CRTC register
	ldrb	r3, [r1], #1
	str	r3, [r0, #4]		@ write its value
	b	InitLoop

WriteText:
	ldr	r1, =Message
	ldr	r3, =0x6019A		@ VRAM cell (5*40+5)*2: row 5, col 5
CopyLoop:
	ldrb	r2, [r1], #1		@ next character (0 = done)
	cmp	r2, #0
	beq	Done
	strb	r2, [r3], #1		@ character byte
	mov	r4, #0x0A		@ attribute: bright green
	strb	r4, [r3], #1
	b	CopyLoop
Done:
	b	Done			@ park here

CrtcTable:				@ pairs of (register, value)
	.byte	1, 40			@ R1  columns displayed
	.byte	6, 25			@ R6  rows displayed
	.byte	9, 7			@ R9  scanlines per row - 1
	.byte	10, 0x40		@ R10 cursor: blink, start line 0
	.byte	11, 7			@ R11 cursor end line
	.byte	12, 0			@ R12 display start (hi)
	.byte	13, 0			@ R13 display start (lo)
	.byte	14, 0			@ R14 cursor address (hi)
	.byte	15, 216			@ R15 cursor address: 5*40+16
	.byte	0xFF, 0xFF
	.balign	4
Message:
	.asciz	"hello world"
	.balign	4
`;

/** What CrtDisplay.svelte renders: CRTC state + the visible VRAM cells. */
export interface CrtView {
	crtc: CrtcSnapshot;
	/** cols*rows*2 bytes starting at the CRTC start address. */
	cells: Uint8Array;
}

/** Bytes of code memory shown in the memory panel (0x10000–0x10100). */
const MEMORY_VIEW_BYTES = 256;
/**
 * Stack window shown in the stack panel. The stack descends from the top
 * of the region (SP starts at 0x10000), so the active bytes are the LAST
 * ones — show the topmost 256 bytes (0xFF00–0xFFFF).
 */
const STACK_VIEW_BYTES = 128;
const STACK_VIEW_BASE =
	MEMORY_MAP.stack.base + MEMORY_MAP.stack.size - STACK_VIEW_BYTES;
/** Data window shown in the data panel (start of working RAM). */
const DATA_VIEW_BYTES = 128;
const DATA_VIEW_BASE = MEMORY_MAP.wram.base;
/** Debounce between an editor change and re-assembly, in ms. */
const ASSEMBLE_DEBOUNCE_MS = 125;
/** Minimum interval for stepped runs; a delay of 0 means full speed. */
export const MIN_RUN_DELAY_MS = 50;
/** Target emulation time per animation frame in full-speed mode. */
const FAST_FRAME_BUDGET_MS = 10;

let machine: Machine;
let assembler: Assembler;
let crtc: Mc6845;

const registersStore = writable<RegisterSnapshot[]>([]);
const memoryStore = writable<DumpRow[]>([]);
const stackStore = writable<DumpRow[]>([]);
const dataStore = writable<DumpRow[]>([]);
const crtStore = writable<CrtView | null>(null);
const pcLineStore = writable<number | null>(null);
const messagesStore = writable<string[]>([]);
const runningStore = writable(false);
const assembleErrorStore = writable<string | null>(null);

export const registers = readonly(registersStore);
export const memory = readonly(memoryStore);
export const stack = readonly(stackStore);
export const data = readonly(dataStore);
export const crt = readonly(crtStore);
/** 0-based source line at PC, for the editor highlight (null = none). */
export const pcLine = readonly(pcLineStore);
export const messages = readonly(messagesStore);
export const running = readonly(runningStore);
export const assembleError = readonly(assembleErrorStore);

let currentSource = DEFAULT_PROGRAM;
let assembleTimer: ReturnType<typeof setTimeout> | undefined;
let runInterval: ReturnType<typeof setInterval> | undefined;
let runFrame: number | undefined;
let previousStackBytes: Uint8Array | undefined;
let previousDataBytes: Uint8Array | undefined;
let lineMap: LineRange[] | null = null;

function refresh(): void {
	registersStore.set(machine.snapshotRegisters());
	memoryStore.set(
		hexdump(
			machine.readMemory(MEMORY_MAP.code.base, MEMORY_VIEW_BYTES),
			MEMORY_MAP.code.base,
			machine.pc(),
			16,
			undefined,
			UDF_WORD, // render the fill pattern dimmed — background, not data
		),
	);
	const stackBytes = machine.readMemory(STACK_VIEW_BASE, STACK_VIEW_BYTES);
	stackStore.set(
		hexdump(stackBytes, STACK_VIEW_BASE, machine.sp(), 16, previousStackBytes),
	);
	previousStackBytes = stackBytes;

	const dataBytes = machine.readMemory(DATA_VIEW_BASE, DATA_VIEW_BYTES);
	// -8 marker: no marked word in the data view.
	dataStore.set(hexdump(dataBytes, DATA_VIEW_BASE, -8, 16, previousDataBytes));
	previousDataBytes = dataBytes;

	pcLineStore.set(lineMap ? lineAt(lineMap, machine.pc()) : null);

	const crtcState = crtc.snapshot();
	const cellBytes = crtcState.cols * crtcState.rows * 2;
	const vram = MEMORY_MAP.vram;
	const offset = (crtcState.startAddress * 2) % vram.size;
	crtStore.set({
		crtc: crtcState,
		cells:
			cellBytes > 0
				? machine.readMemory(
						vram.base + offset,
						Math.min(cellBytes, vram.size - offset),
					)
				: new Uint8Array(0),
	});
}

function log(message: string): void {
	messagesStore.update((entries) => [message, ...entries]);
}

function assembleNow(): void {
	const result = assembler.assemble(currentSource, MEMORY_MAP.code.base);
	lineMap = null;
	if (!result.ok) {
		assembleErrorStore.set(result.message);
		refresh();
		return;
	}
	const run = longestStraightRun(result.bytes);
	if (run > MAX_STRAIGHT_RUN) {
		assembleErrorStore.set(
			`Program has ${run} consecutive non-branch instructions; the emulator ` +
				`supports at most ${MAX_STRAIGHT_RUN} in a row — split the sequence ` +
				`with a branch.`,
		);
		refresh();
		return;
	}
	assembleErrorStore.set(null);
	machine.loadProgram(result.bytes);
	lineMap = buildLineMap(
		assembler,
		currentSource,
		MEMORY_MAP.code.base,
		result.bytes.length,
	);
	refresh();
}

/** Called by the editor on every change; re-assembles after a short pause. */
export function sourceChanged(source: string): void {
	currentSource = source;
	clearTimeout(assembleTimer);
	assembleTimer = setTimeout(assembleNow, ASSEMBLE_DEBOUNCE_MS);
}

export function step(): boolean {
	const result = machine.step(1);
	if (!result.ok) {
		log(result.message);
	}
	refresh();
	return result.ok;
}

function stopRun(): void {
	if (runInterval !== undefined) {
		clearInterval(runInterval);
		runInterval = undefined;
	}
	if (runFrame !== undefined) {
		cancelAnimationFrame(runFrame);
		runFrame = undefined;
	}
	runningStore.set(false);
}

export function toggleRun(delayMs: number): void {
	if (runInterval !== undefined || runFrame !== undefined) {
		stopRun();
		return;
	}
	runningStore.set(true);
	if (delayMs <= 0) {
		// Full speed: batch instructions into single engine calls, sized so
		// each animation frame spends ~FAST_FRAME_BUDGET_MS emulating, and
		// refresh the UI once per frame.
		let batch = 5000;
		const frame = () => {
			const started = performance.now();
			const result = machine.run(batch);
			const elapsed = performance.now() - started;
			if (elapsed > 0.5) {
				batch = Math.max(
					1000,
					Math.min(2_000_000, Math.round((batch * FAST_FRAME_BUDGET_MS) / elapsed)),
				);
			}
			refresh();
			if (!result.ok) {
				log(result.message);
				stopRun();
				return;
			}
			runFrame = requestAnimationFrame(frame);
		};
		runFrame = requestAnimationFrame(frame);
		return;
	}
	runInterval = setInterval(() => {
		if (!step()) {
			stopRun();
		}
	}, Math.max(MIN_RUN_DELAY_MS, delayMs));
}

export function reset(): void {
	messagesStore.set([]);
	clearTimeout(assembleTimer);
	assembleNow();
}

/**
 * Construct the core and assemble the default program. Must be called
 * after `initEngine()` has resolved and before the UI is mounted.
 */
export function initState(): void {
	machine = new Machine();
	assembler = new Assembler();
	crtc = new Mc6845(MEMORY_MAP.mmio.base);
	machine.attachPeripheral(crtc);
	assembleNow();
}
