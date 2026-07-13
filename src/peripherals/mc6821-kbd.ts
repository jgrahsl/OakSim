import type { Peripheral } from './peripheral';

/**
 * Apple I-style MC6821 PIA keyboard interface.
 *
 * The historical setup: the keyboard's encoder delivered 7-bit ASCII plus
 * a strobe into a 6821 PIA; software polled a status bit and read the
 * character register, which cleared the strobe. OakSim maps the same
 * model onto two word-spaced MMIO registers (like the CRTC):
 *
 *   base + 0  KBD    (read: oldest ASCII char; reading pops it)
 *   base + 4  KBDCR  (read: bit 7 set while a key is available)
 *
 * A small FIFO provides type-ahead. The UI feeds it via enqueue() from
 * keydown events on the focused CRT canvas.
 *
 * Polling idiom:
 *   Poll: ldr r1, [r0, #4]   @ KBDCR
 *         tst r1, #0x80
 *         beq Poll
 *         ldr r2, [r0]       @ ASCII char (pops the FIFO)
 */
const FIFO_CAPACITY = 16;

export class Mc6821Keyboard implements Peripheral {
	readonly name = 'MC6821 keyboard';
	readonly size = 8;

	private fifo: number[] = [];

	constructor(readonly base: number) {}

	/** Feed one ASCII code from the host (dropped if the FIFO is full). */
	enqueue(code: number): void {
		if (this.fifo.length < FIFO_CAPACITY) {
			this.fifo.push(code & 0x7f);
		}
	}

	pending(): number {
		return this.fifo.length;
	}

	read(offset: number): number {
		if (offset === 0) {
			return this.fifo.shift() ?? 0;
		}
		if (offset === 4) {
			return this.fifo.length > 0 ? 0x80 : 0;
		}
		return 0;
	}

	write(): void {
		// All registers are read-only toward the guest.
	}

	reset(): void {
		this.fifo = [];
	}
}
