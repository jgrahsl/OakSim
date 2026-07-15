import type { Peripheral } from './peripheral';

/**
 * Millisecond timer (loosely in the spirit of the MC6840 PTM, but
 * wall-clock based and reduced to what a polling guest needs). Two
 * word-spaced registers:
 *
 *   base + 0  MS         read: free-running millisecond counter
 *                        write: reset the counter to zero
 *   base + 4  COUNTDOWN  write: arm a countdown of N milliseconds
 *                        read: remaining ms (0 = expired/unarmed)
 *
 * Sleep idiom:
 *   ldr  r0, =0x70020
 *   mov  r1, #250
 *   str  r1, [r0, #4]    @ sleep 250 ms
 *   Wait: ldr r1, [r0, #4]
 *   cmp  r1, #0
 *   bne  Wait
 *
 * Wall-clock time keeps sleeps meaningful in both run modes: a Fast run
 * spins the poll loop, a stepped run crawls it, but both wake after the
 * same real duration. No interrupts: guest exceptions are unsurvivable
 * on this engine build, so polling is the model (see docs).
 */
export class Timer implements Peripheral {
	readonly name = 'Timer';
	readonly size = 8;

	private epoch: number;
	private deadline: number | null = null;

	constructor(
		readonly base: number,
		/** Injectable clock (ms), for tests. */
		private now: () => number = () => performance.now(),
	) {
		this.epoch = this.now();
	}

	read(offset: number): number {
		if (offset === 0) {
			return Math.floor(this.now() - this.epoch) >>> 0;
		}
		if (offset === 4) {
			if (this.deadline === null) return 0;
			const remaining = Math.ceil(this.deadline - this.now());
			if (remaining <= 0) {
				this.deadline = null;
				return 0;
			}
			return remaining >>> 0;
		}
		return 0;
	}

	write(offset: number, value: number): void {
		if (offset === 0) {
			this.epoch = this.now();
		} else if (offset === 4) {
			this.deadline = this.now() + (value >>> 0);
		}
	}

	reset(): void {
		this.epoch = this.now();
		this.deadline = null;
	}
}
