import { Cpu } from './cpu';
import { Bus } from './bus';
import { uc } from './engine';
import type { Peripheral } from '../peripherals/peripheral';
import type { RegisterSnapshot, StepResult } from './types';

/**
 * Guest physical memory layout (see docs/PERIPHERALS.md).
 * VRAM is plain RAM scanned by the display controller; MMIO is the
 * hooked window where peripheral registers live.
 */
export const MEMORY_MAP = {
	stack: { base: 0x08000, size: 0x08000 }, // descending; SP starts at the top
	code: { base: 0x10000, size: 0x30000 },
	wram: { base: 0x40000, size: 0x20000 },
	vram: { base: 0x60000, size: 0x10000 },
	mmio: { base: 0x70000, size: 0x01000 },
} as const;

export const CODE_END = MEMORY_MAP.code.base + MEMORY_MAP.code.size;

/**
 * ENGINE LIMITATION (unicorn-js 2.1.4 WASM): stopping execution inside a
 * translation block longer than ~33 instructions traps the WASM runtime
 * and poisons the engine. Blocks end at branches/undefined instructions,
 * so three measures keep every reachable block small:
 *  - unused code memory is filled with zeros plus a UDF word every
 *    FILL_STRIDE_WORDS (a zero-filled sea would form one giant all-NOP
 *    block — the pre-refactor garbage accidentally prevented this);
 *  - a UDF terminator is placed right after the loaded program;
 *  - programs with a straight-line run longer than MAX_STRAIGHT_RUN
 *    instructions are rejected at load time (see longestStraightRun).
 * Stepping additionally uses `until = pc + 4`, which caps translation at
 * the next instruction, so straight-line stepping never stops mid-block.
 */
const UDF_WORD = 0xe7f000f0;
const FILL_STRIDE_WORDS = 16;
export const MAX_STRAIGHT_RUN = 32;

/** Fill pattern for a code-region range starting at word offset 0. */
function buildFill(byteLength: number): Uint8Array {
	const fill = new Uint8Array(byteLength);
	const view = new DataView(fill.buffer);
	for (let w = FILL_STRIDE_WORDS - 1; w * 4 < byteLength; w += FILL_STRIDE_WORDS) {
		view.setUint32(w * 4, UDF_WORD, true);
	}
	return fill;
}

/** True if this ARM instruction always ends a translation block. */
function endsBlock(word: number): boolean {
	if ((word & 0x0e000000) === 0x0a000000) return true; // B / BL
	if ((word & 0x0fffffd0) === 0x012fff10) return true; // BX / BLX (register)
	if ((word & 0x0e108000) === 0x08108000) return true; // LDM {..., pc}
	if ((word & 0x0c10f000) === 0x0410f000) return true; // LDR pc, [...]
	if ((word & 0x0c00f000) === 0x0000f000) return true; // ALU with Rd = pc
	if ((word & 0x0ff000f0) === 0x07f000f0) return true; // UDF
	return false;
}

/**
 * Longest run of consecutive words with no block-ending instruction.
 * (Data pools count as instructions — a conservative over-estimate.)
 */
export function longestStraightRun(bytes: Uint8Array): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let longest = 0;
	let current = 0;
	for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
		if (endsBlock(view.getUint32(offset, true))) {
			current = 0;
		} else {
			current++;
			longest = Math.max(longest, current);
		}
	}
	return longest;
}

interface RegisterDef {
	name: string;
	id: number;
}

/**
 * The simulated machine: CPU + memory map + reset/load/step logic.
 * Framework-free; the UI observes it exclusively through snapshots.
 */
export class Machine {
	readonly cpu: Cpu;
	readonly bus: Bus;
	private registerDefs: RegisterDef[];
	private previousValues: number[];
	/** Stepping state shared with the code hook (see stepOne / run). */
	private stepStartPc = 0;
	private stepStartHits = 0;
	private stepStopAddr: number | null = null;
	/** When non-null the hook is in batch mode: count down, then stop. */
	private runBudget: number | null = null;
	/** Length of the loaded program (execution is confined to it). */
	private programLength = 0;
	/** Set when the hook stopped execution for leaving the program. */
	private leftProgram = false;

	constructor() {
		this.cpu = new Cpu();
		// Regions are mapped exactly once: remapping returns recycled,
		// garbage-filled pages on this engine build. RAM regions keep
		// their contents across reset (warm-reset semantics).
		const { stack, code, wram, vram, mmio } = MEMORY_MAP;
		this.cpu.memMap(stack.base, stack.size, uc.PROT_READ | uc.PROT_WRITE);
		this.cpu.memMap(code.base, code.size, uc.PROT_ALL);
		this.cpu.memMap(wram.base, wram.size, uc.PROT_READ | uc.PROT_WRITE);
		this.cpu.memMap(vram.base, vram.size, uc.PROT_READ | uc.PROT_WRITE);
		this.cpu.memWrite(code.base, buildFill(code.size));
		this.bus = new Bus(this.cpu, mmio.base, mmio.size);

		// This hook fires before each instruction executes and implements
		// three things:
		//  - confinement: execution outside the loaded program's bytes is
		//    stopped BEFORE it happens. This is load-bearing: letting the
		//    CPU raise a real exception (e.g. executing the UDF terminator)
		//    permanently damages this engine build — afterwards, rewritten
		//    code keeps executing stale translation blocks.
		//  - batch mode (runBudget set): count instructions down, then stop.
		//  - single-step mode: stop at the first instruction that is not
		//    the one being stepped — a branch target, or the same address
		//    again for a `b .` self-loop.
		// Stopping mid-block is safe because every reachable block is kept
		// under the ~33-instruction engine limit (see note above).
		this.cpu.hookAdd(
			uc.HOOK_CODE,
			(_engine: unknown, address: bigint) => {
				if (this.stepStopAddr !== null) return;
				const addr = Number(address);
				if (
					addr < MEMORY_MAP.code.base ||
					addr >= MEMORY_MAP.code.base + this.programLength
				) {
					this.leftProgram = true;
					this.stepStopAddr = addr;
					this.cpu.emuStop();
					return;
				}
				if (this.runBudget !== null) {
					if (--this.runBudget < 0) {
						this.stepStopAddr = addr;
						this.cpu.emuStop();
					}
					return;
				}
				if (addr !== this.stepStartPc || ++this.stepStartHits > 1) {
					this.stepStopAddr = addr;
					this.cpu.emuStop();
				}
			},
			null,
			0,
			0xffff_ffff,
		);

		// Without an interrupt hook this engine build silently swallows CPU
		// exceptions (e.g. executing UDF) in batch runs and leaves the
		// engine in a bad state; with one installed, emu_start reports them
		// as proper errors. The callback body is irrelevant.
		this.cpu.hookAdd(uc.HOOK_INTR, () => {}, null, 1, 0);

		this.registerDefs = [
			{ name: 'R0', id: uc.ARM_REG_R0 },
			{ name: 'R1', id: uc.ARM_REG_R1 },
			{ name: 'R2', id: uc.ARM_REG_R2 },
			{ name: 'R3', id: uc.ARM_REG_R3 },
			{ name: 'R4', id: uc.ARM_REG_R4 },
			{ name: 'R5', id: uc.ARM_REG_R5 },
			{ name: 'R6', id: uc.ARM_REG_R6 },
			{ name: 'R7', id: uc.ARM_REG_R7 },
			{ name: 'R8', id: uc.ARM_REG_R8 },
			{ name: 'R9', id: uc.ARM_REG_R9 },
			{ name: 'R10', id: uc.ARM_REG_R10 },
			{ name: 'R11', id: uc.ARM_REG_R11 },
			{ name: 'R12', id: uc.ARM_REG_R12 },
			{ name: 'SP', id: uc.ARM_REG_SP },
			{ name: 'LR', id: uc.ARM_REG_LR },
			{ name: 'PC', id: uc.ARM_REG_PC },
			{ name: 'CPSR', id: uc.ARM_REG_CPSR },
		];
		this.previousValues = this.registerDefs.map(() => 0);
		this.reset();
	}

	/**
	 * Rebuild code memory and zero the CPU. The code region is unmapped,
	 * remapped and fully refilled: plain rewrites do not reliably
	 * invalidate multi-instruction translation blocks on this engine
	 * build (stale code would keep executing), while remapping drops
	 * them. The full refill replaces the recycled-page garbage the remap
	 * brings in. RAM regions stay mapped (contents persist, and nothing
	 * executes from them).
	 */
	reset(): void {
		const { stack, code } = MEMORY_MAP;
		this.cpu.memUnmapSafe(code.base, code.size);
		this.cpu.memMap(code.base, code.size, uc.PROT_ALL);
		this.cpu.memWrite(code.base, buildFill(code.size));
		this.programLength = 0;

		for (const def of this.registerDefs) {
			this.cpu.regWrite(def.id, 0);
		}
		this.cpu.regWrite(uc.ARM_REG_SP, stack.base + stack.size);
		this.cpu.regWrite(uc.ARM_REG_PC, code.base);
		this.bus?.reset();
	}

	attachPeripheral(device: Peripheral): void {
		this.bus.attach(device);
	}

	/**
	 * Reset the machine and place a program (plus a UDF terminator) at the
	 * start of code memory. Callers should check the program with
	 * longestStraightRun() first — see the engine limitation note above.
	 */
	loadProgram(bytes: Uint8Array): void {
		this.reset();
		const { code } = MEMORY_MAP;
		if (bytes.length > 0) {
			this.cpu.memWrite(code.base, bytes);
		}
		const terminator = new Uint8Array(4);
		new DataView(terminator.buffer).setUint32(0, UDF_WORD, true);
		this.cpu.memWrite(code.base + bytes.length, terminator);
		this.programLength = bytes.length;
	}

	/** Execute up to `count` instructions from the current PC. */
	step(count: number): StepResult {
		for (let i = 0; i < count; i++) {
			const result = this.stepOne();
			if (!result.ok) {
				return result;
			}
		}
		return { ok: true };
	}

	/**
	 * Fast path for Run mode: execute up to `budget` instructions in a
	 * single engine call (orders of magnitude faster than step(), which
	 * pays one emu_start round-trip per instruction).
	 */
	run(budget: number): StepResult {
		const pc = this.pc();
		const guard = this.guardPc(pc);
		if (guard) return guard;
		this.runBudget = budget;
		this.stepStopAddr = null;
		this.leftProgram = false;
		try {
			this.cpu.emuStart(pc, CODE_END);
		} catch (error) {
			return { ok: false, message: String(error) };
		} finally {
			this.runBudget = null;
		}
		return this.finishStop();
	}

	/** Common tail of run()/stepOne(): apply the stop address, map the
	 *  left-the-program stop to an error result. */
	private finishStop(): StepResult {
		if (this.stepStopAddr !== null) {
			this.cpu.regWrite(uc.ARM_REG_PC, this.stepStopAddr);
		}
		if (this.leftProgram) {
			this.leftProgram = false;
			return {
				ok: false,
				message:
					'execution left the program at PC 0x' +
					this.pc().toString(16) +
					' (fell off the end or jumped outside it); reset to recover',
			};
		}
		return { ok: true };
	}

	private guardPc(pc: number): StepResult | null {
		// Starting emu_start at an unfetchable address livelocks this
		// engine build (a mid-run branch to one throws correctly).
		if (pc < MEMORY_MAP.code.base || pc >= CODE_END) {
			return {
				ok: false,
				message:
					'PC 0x' + pc.toString(16) + ' is outside code memory; reset to recover',
			};
		}
		return null;
	}

	private stepOne(): StepResult {
		const pc = this.pc();
		const guard = this.guardPc(pc);
		if (guard) return guard;
		this.stepStartPc = pc;
		this.stepStartHits = 0;
		this.stepStopAddr = null;
		this.runBudget = null;
		this.leftProgram = false;
		try {
			// `until = pc + 4` caps translation at the next instruction, so
			// sequential steps stop by address without touching emu_stop.
			this.cpu.emuStart(pc, pc + 4);
		} catch (error) {
			return { ok: false, message: String(error) };
		}
		// After a hook-initiated stop the engine can leave a stale PC; the
		// hook's address is authoritative.
		return this.finishStop();
	}

	pc(): number {
		return this.cpu.regRead(uc.ARM_REG_PC);
	}

	sp(): number {
		return this.cpu.regRead(uc.ARM_REG_SP);
	}

	/**
	 * Read all registers, marking those that changed since the previous
	 * snapshot (used for highlighting in the UI).
	 */
	snapshotRegisters(): RegisterSnapshot[] {
		return this.registerDefs.map((def, index) => {
			const value = this.cpu.regRead(def.id);
			const changed = value !== this.previousValues[index];
			this.previousValues[index] = value;
			return { name: def.name, value, changed };
		});
	}

	readMemory(address: number, length: number): Uint8Array {
		return this.cpu.memRead(address, length);
	}
}
