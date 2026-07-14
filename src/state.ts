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
import helloSource from '../examples/hello.s?raw';
import keyboardSource from '../examples/keyboard.s?raw';
import { buildLineMap, lineAt, type LineRange } from './core/linemap';
import { Mc6845, type CrtcSnapshot } from './peripherals/mc6845';
import { Mc6821Keyboard } from './peripherals/mc6821-kbd';
import type { RegisterSnapshot } from './core/types';

export const DEFAULT_PROGRAM = helloSource;
export const KEYBOARD_PROGRAM = keyboardSource;

/** What CrtDisplay.svelte renders: CRTC state + the visible VRAM cells. */
export interface CrtView {
	crtc: CrtcSnapshot;
	/** cols*rows*2 bytes starting at the CRTC start address. */
	cells: Uint8Array;
}

/**
 * Program slots, persisted in localStorage. The named slots are built-in
 * demos ('default' = 6845 hello world, 'keyboard' = MC6821 demo) and are
 * immutable — edits to them are ephemeral. Numbered slots autosave on
 * every edit and on switching away, so the active program survives page
 * reloads.
 */
export type ProgramSlot = 'default' | 'keyboard' | number;
const BUILTIN_PROGRAMS: Record<string, string> = {
	default: helloSource,
	keyboard: keyboardSource,
};
export const SLOT_COUNT = 4;
const ACTIVE_SLOT_KEY = 'oaksim.activeSlot';
const slotKey = (slot: number) => `oaksim.program.${slot}`;
const storage: Storage | null =
	typeof localStorage === 'undefined' ? null : localStorage;

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
/** Character-memory window: the full 40x25 text buffer (2 bytes/cell). */
const VRAM_VIEW_BYTES = 2048;
/** Debounce between an editor change and re-assembly, in ms. */
const ASSEMBLE_DEBOUNCE_MS = 125;
/** Minimum interval for stepped runs; a delay of 0 means full speed. */
const MIN_RUN_DELAY_MS = 50;
/** Target emulation time per animation frame in full-speed mode. */
const FAST_FRAME_BUDGET_MS = 10;

let machine: Machine;
let assembler: Assembler;
let crtc: Mc6845;
let keyboard: Mc6821Keyboard;

const registersStore = writable<RegisterSnapshot[]>([]);
const memoryStore = writable<DumpRow[]>([]);
const stackStore = writable<DumpRow[]>([]);
const dataStore = writable<DumpRow[]>([]);
const vramStore = writable<DumpRow[]>([]);
const crtStore = writable<CrtView | null>(null);
const pcLineStore = writable<number | null>(null);
const activeSlotStore = writable<ProgramSlot>('default');
const messagesStore = writable<string[]>([]);
const runningStore = writable(false);
const assembleErrorStore = writable<string | null>(null);

export const registers = readonly(registersStore);
export const memory = readonly(memoryStore);
export const stack = readonly(stackStore);
export const data = readonly(dataStore);
export const vram = readonly(vramStore);
export const crt = readonly(crtStore);
/** 0-based source line at PC, for the editor highlight (null = none). */
export const pcLine = readonly(pcLineStore);
export const activeSlot = readonly(activeSlotStore);
export const messages = readonly(messagesStore);
export const running = readonly(runningStore);
export const assembleError = readonly(assembleErrorStore);

let currentSource = DEFAULT_PROGRAM;
let currentSlot: ProgramSlot = 'default';
let assembleTimer: ReturnType<typeof setTimeout> | undefined;
let runInterval: ReturnType<typeof setInterval> | undefined;
let runFrame: number | undefined;
let previousStackBytes: Uint8Array | undefined;
let previousDataBytes: Uint8Array | undefined;
let previousVramBytes: Uint8Array | undefined;
let lineMap: LineRange[] | null = null;

function refresh(): void {
	registersStore.set(machine.snapshotRegisters());
	memoryStore.set(
		hexdump(machine.readMemory(MEMORY_MAP.code.base, MEMORY_VIEW_BYTES), MEMORY_MAP.code.base, {
			markers: [{ address: machine.pc(), kind: 'pc' }],
			dimWord: UDF_WORD, // render the fill pattern dimmed — background, not data
		}),
	);
	const stackBytes = machine.readMemory(STACK_VIEW_BASE, STACK_VIEW_BYTES);
	stackStore.set(
		hexdump(stackBytes, STACK_VIEW_BASE, {
			markers: [
				{ address: machine.sp(), kind: 'sp' },
				{ address: machine.fp(), kind: 'fp' },
			],
			previous: previousStackBytes,
		}),
	);
	previousStackBytes = stackBytes;

	const dataBytes = machine.readMemory(DATA_VIEW_BASE, DATA_VIEW_BYTES);
	dataStore.set(hexdump(dataBytes, DATA_VIEW_BASE, { previous: previousDataBytes }));
	previousDataBytes = dataBytes;

	pcLineStore.set(lineMap ? lineAt(lineMap, machine.pc()) : null);

	const crtcState = refreshCrt();
	const vramBytes = machine.readMemory(MEMORY_MAP.vram.base, VRAM_VIEW_BYTES);
	vramStore.set(
		hexdump(vramBytes, MEMORY_MAP.vram.base, {
			markers: [
				{ address: MEMORY_MAP.vram.base + crtcState.cursorAddress * 2, kind: 'cursor' },
			],
			width: 32,
			previous: previousVramBytes,
		}),
	);
	previousVramBytes = vramBytes;
}

/**
 * Update only the CRT store — the cheap per-frame refresh used during
 * full-speed runs, where the debug panes (registers, hexdumps, PC line)
 * are deferred until the run stops. Keyboard input needs no refresh at
 * all: keystrokes go straight into the peripheral's FIFO.
 */
function refreshCrt(): CrtcSnapshot {
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
	return crtcState;
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
	persistCurrentSlot();
	clearTimeout(assembleTimer);
	assembleTimer = setTimeout(assembleNow, ASSEMBLE_DEBOUNCE_MS);
}

function persistCurrentSlot(): void {
	if (typeof currentSlot === 'number') {
		storage?.setItem(slotKey(currentSlot), currentSource);
	}
}

function slotText(slot: ProgramSlot): string {
	if (typeof slot !== 'number') {
		return BUILTIN_PROGRAMS[slot];
	}
	return (
		storage?.getItem(slotKey(slot)) ??
		`@ Program ${slot} — autosaved in your browser\n`
	);
}

/** The source belonging to the active slot (initial editor content). */
export function currentProgram(): string {
	return currentSource;
}

/**
 * Save the current program into its slot ('default' is immutable, so
 * edits to it are discarded), activate `slot`, and return its text.
 * The caller puts the text into the editor, whose change event triggers
 * re-assembly.
 */
export function selectSlot(slot: ProgramSlot): string {
	persistCurrentSlot();
	stopRun();
	currentSlot = slot;
	activeSlotStore.set(slot);
	storage?.setItem(ACTIVE_SLOT_KEY, String(slot));
	return slotText(slot);
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
	const wasRunning = runInterval !== undefined || runFrame !== undefined;
	if (runInterval !== undefined) {
		clearInterval(runInterval);
		runInterval = undefined;
	}
	if (runFrame !== undefined) {
		cancelAnimationFrame(runFrame);
		runFrame = undefined;
	}
	runningStore.set(false);
	if (wasRunning) {
		refresh(); // sync the deferred debug panes with the final state
	}
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
			// Per-frame, only the screen matters; the debug panes catch up
			// in stopRun() once the run ends.
			refreshCrt();
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

/** Feed a keystroke (ASCII) into the keyboard peripheral's FIFO. */
export function keyInput(code: number): void {
	keyboard.enqueue(code);
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
	keyboard = new Mc6821Keyboard(MEMORY_MAP.mmio.base + 0x10);
	machine.attachPeripheral(keyboard);

	// Restore the slot that was active before the last reload.
	const persisted = storage?.getItem(ACTIVE_SLOT_KEY);
	if (persisted !== null && persisted !== undefined && persisted in BUILTIN_PROGRAMS) {
		currentSlot = persisted as ProgramSlot;
	} else {
		const slot = Number(persisted);
		currentSlot =
			persisted !== null &&
			persisted !== undefined &&
			Number.isInteger(slot) &&
			slot >= 0 &&
			slot < SLOT_COUNT
				? slot
				: 'default';
	}
	activeSlotStore.set(currentSlot);
	currentSource = slotText(currentSlot);

	assembleNow();
}
