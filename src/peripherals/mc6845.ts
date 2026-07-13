import type { Peripheral } from './peripheral';

/**
 * Motorola 6845 CRT controller (CRTC).
 *
 * The real chip is an address/timing generator with 18 registers (R0–R17)
 * behind a two-register bus interface. OakSim maps that interface onto
 * two word-spaced MMIO locations (ARM-friendly: plain str/ldr):
 *
 *   base + 0  address register (write: select R0..R17)
 *   base + 4  data register    (read/write the selected register)
 *
 * Surrounding-hardware convention (MDA-like): the CRTC scans a text
 * buffer in VRAM, 2 bytes per cell (character code, attribute byte);
 * geometry comes from R1 (columns) / R6 (rows) / R9 (scanlines per row),
 * the display starts at R12/R13, and the cursor sits at R14/R15 shaped
 * by R10/R11. The renderer (CrtDisplay.svelte) consumes snapshot().
 */

/** Writable-bit masks for R0..R17 (per the MC6845 datasheet). */
const REGISTER_MASKS = [
	0xff, 0xff, 0xff, 0xff, 0x7f, 0x1f, 0x7f, 0x7f, 0xff, 0x1f,
	0x7f, 0x1f, 0x3f, 0xff, 0x3f, 0xff, 0x3f, 0xff,
] as const;

export type CursorMode = 'steady' | 'off' | 'blink' | 'blink-slow';

export interface CrtcSnapshot {
	/** R1: characters per row. */
	cols: number;
	/** R6: rows displayed. */
	rows: number;
	/** R9 + 1: scanlines per character row. */
	charHeight: number;
	/** (R12<<8 | R13): VRAM cell offset of the top-left character. */
	startAddress: number;
	/** (R14<<8 | R15): VRAM cell offset of the cursor. */
	cursorAddress: number;
	/** R10 bits 0-4 / R11 bits 0-4: cursor scanline extent. */
	cursorStartLine: number;
	cursorEndLine: number;
	/** R10 bits 5-6. */
	cursorMode: CursorMode;
	/** Raw R0..R17 (for debug panels). */
	registers: number[];
}

const CURSOR_MODES: CursorMode[] = ['steady', 'off', 'blink', 'blink-slow'];

export class Mc6845 implements Peripheral {
	readonly name = 'MC6845 CRTC';
	readonly size = 8;

	private registers = new Uint8Array(18);
	private addressRegister = 0;

	constructor(readonly base: number) {}

	write(offset: number, value: number): void {
		if (offset === 0) {
			this.addressRegister = value & 0x1f;
		} else if (offset === 4 && this.addressRegister < 18) {
			this.registers[this.addressRegister] =
				value & REGISTER_MASKS[this.addressRegister];
		}
	}

	read(offset: number): number {
		if (offset === 4 && this.addressRegister < 18) {
			// Lenient: the real chip only exposes R12..R17 for reads.
			return this.registers[this.addressRegister];
		}
		return 0;
	}

	reset(): void {
		this.registers.fill(0);
		this.addressRegister = 0;
	}

	snapshot(): CrtcSnapshot {
		const r = this.registers;
		return {
			cols: r[1],
			rows: r[6],
			charHeight: r[9] + 1,
			startAddress: (r[12] << 8) | r[13],
			cursorAddress: (r[14] << 8) | r[15],
			cursorStartLine: r[10] & 0x1f,
			cursorEndLine: r[11] & 0x1f,
			cursorMode: CURSOR_MODES[(r[10] >> 5) & 3],
			registers: Array.from(r),
		};
	}
}
