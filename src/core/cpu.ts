import { uc } from './engine';

/**
 * Thin typed wrapper around the Unicorn 2 ARM emulator (WASM build,
 * @alexaltea/unicorn-js). This is the only module that talks to the
 * Unicorn instance API directly. Requires `initEngine()` to have resolved.
 *
 * Note: in hook callbacks the engine passes 64-bit quantities (addresses,
 * written values) as BigInt — convert with `Number(...)` at the boundary.
 */
export class Cpu {
	private engine: any;

	constructor() {
		this.engine = new uc.Unicorn(uc.ARCH_ARM, uc.MODE_ARM);
	}

	regRead(id: number): number {
		return this.engine.reg_read_i32(id) >>> 0;
	}

	regWrite(id: number, value: number): void {
		this.engine.reg_write_i32(id, value);
	}

	memMap(address: number, size: number, protection: number): void {
		this.engine.mem_map(address, size, protection);
	}

	/** Unmap a region, ignoring the error if it was never mapped. */
	memUnmapSafe(address: number, size: number): void {
		try {
			this.engine.mem_unmap(address, size);
		} catch {
			// Region was not mapped yet (first reset).
		}
	}

	memRead(address: number, length: number): Uint8Array {
		return new Uint8Array(this.engine.mem_read(address, length));
	}

	memWrite(address: number, bytes: Uint8Array): void {
		this.engine.mem_write(address, bytes);
	}

	/**
	 * Execute from `begin` until `until` is reached or `emu_stop()` is
	 * called from a hook. Do NOT pass a non-zero instruction count: the
	 * count-based stop crashes the 2.1.4 WASM build (out-of-bounds inside
	 * the engine). Use a HOOK_CODE budget + emuStop() instead — see
	 * Machine.step().
	 */
	emuStart(begin: number, until: number): void {
		this.engine.emu_start(begin, until, 0, 0);
	}

	emuStop(): void {
		this.engine.emu_stop();
	}

	hookAdd(
		type: number,
		callback: (...args: any[]) => any,
		userData: unknown,
		begin: number,
		end: number,
	): unknown {
		return this.engine.hook_add(type, callback, userData, begin, end);
	}

	dispose(): void {
		this.engine.close();
	}
}
