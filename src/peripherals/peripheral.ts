/**
 * Contract for a memory-mapped peripheral. A device occupies an address
 * range inside the MMIO window and is driven by guest loads/stores, which
 * the Bus routes to read()/write(). Devices are plain TypeScript objects:
 * they hold their own register state, know nothing about the UI, and
 * expose whatever snapshot method their panel needs.
 *
 * To add a peripheral: implement this interface, attach an instance via
 * Machine.attachPeripheral(), and (if it has a visual presence) add a
 * Svelte component that renders its snapshot from a store published in
 * state.ts. See Mc6845 / CrtDisplay.svelte for the reference example.
 */
export interface Peripheral {
	/** Display name (for debug panels/messages). */
	readonly name: string;
	/** Absolute base address of the device's registers. */
	readonly base: number;
	/** Size of the device's register window in bytes. */
	readonly size: number;
	/** Guest load from base+offset; returns the value to deliver. */
	read(offset: number, size: number): number;
	/** Guest store to base+offset. */
	write(offset: number, value: number, size: number): void;
	/** Return to power-on state (called on machine reset). */
	reset(): void;
}
