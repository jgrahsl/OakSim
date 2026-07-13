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

/**
 * Match the assembler's target to the emulated CPU (Unicorn's default is
 * a Cortex-A15). Keystone's bare ARM target rejects some instructions
 * the core executes fine — notably A32 udiv/sdiv — so every assembly is
 * prefixed with this directive. It emits no bytes, so addresses and the
 * source line map are unaffected; a program's own .cpu/.arch directives
 * still override it.
 */
const TARGET_PRELUDE = '.cpu cortex-a15\n';

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
			const bytes = this.engine.asm(TARGET_PRELUDE + source, { address });
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
