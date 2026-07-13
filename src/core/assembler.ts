import { Keystone, Const, loadKeystone } from 'keystone-wasm';
import type { AssembleResult } from './types';

/**
 * Loads the Keystone WASM module; must resolve before an Assembler is
 * constructed (mirrors initEngine() for Unicorn).
 *
 * History: the previously vendored 2017 keystone.min.js encoded every
 * `bl label` as a branch-to-self (0xEBFFFFFE) regardless of the label —
 * function calls never worked. keystone-wasm assembles them correctly;
 * tests/core.test.ts carries a regression test.
 */
export async function initAssembler(): Promise<void> {
	await loadKeystone();
}

/** Wraps the Keystone ARM assembler (GAS syntax). */
export class Assembler {
	private engine: Keystone;

	constructor() {
		this.engine = new Keystone(Const.KS_ARCH_ARM, Const.KS_MODE_ARM);
	}

	/**
	 * Assemble GAS-syntax ARM source. `address` is the load address, used
	 * to resolve absolute references (literal pools, `.word label`).
	 */
	assemble(source: string, address = 0): AssembleResult {
		try {
			const bytes = this.engine.asm(source, { address });
			return { ok: true, bytes };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	dispose(): void {
		this.engine.close();
	}
}
