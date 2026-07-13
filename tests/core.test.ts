import { describe, it, expect, beforeAll } from 'vitest';
import { Assembler } from '../src/core/assembler';
import { uc } from '../src/core/engine';
import { Machine, MEMORY_MAP, CODE_END } from '../src/core/machine';
import { hexdump } from '../src/core/hexdump';

// Shared instances: Keystone/Unicorn contexts are heavyweight inside the
// Emscripten heap, so we reuse one of each across tests.
let assembler: Assembler;
let machine: Machine;

beforeAll(() => {
	assembler = new Assembler();
	machine = new Machine();
});

function assembleOk(source: string): Uint8Array {
	const result = assembler.assemble(source, MEMORY_MAP.code.base);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('unreachable');
	return result.bytes;
}

describe('Assembler', () => {
	it('assembles a known ARM instruction to its exact encoding', () => {
		// add r0, r0, #1  ->  0xE2800001 (little-endian in memory)
		expect(Array.from(assembleOk('add r0, r0, #1'))).toEqual([0x01, 0x00, 0x80, 0xe2]);
	});

	it('assembles mov with immediate', () => {
		// mov r0, #5  ->  0xE3A00005
		expect(Array.from(assembleOk('mov r0, #5'))).toEqual([0x05, 0x00, 0xa0, 0xe3]);
	});

	it('assembles multi-instruction programs with labels', () => {
		const bytes = assembleOk('Loop:\n\tadd r0, r0, #1\n\tmul r1, r0, r0\n\tb Loop');
		expect(bytes.length).toBe(12);
	});

	it('reports failure for invalid source', () => {
		const result = assembler.assemble('definitely_not_an_instruction r99');
		expect(result.ok).toBe(false);
	});

	// Regression: the old vendored keystone.min.js encoded every `bl label`
	// as branch-to-self (0xEBFFFFFE) — function calls never worked.
	it('encodes bl to a forward label correctly', () => {
		const bytes = assembleOk('bl func\nmov r0, #1\nfunc:\nmov r0, #2');
		expect(Array.from(bytes.slice(0, 4))).toEqual([0x00, 0x00, 0x00, 0xeb]);
	});

	it('encodes bl to a backward label correctly', () => {
		const bytes = assembleOk('func:\nmov r0, #2\nbl func');
		expect(Array.from(bytes.slice(4, 8))).toEqual([0xfd, 0xff, 0xff, 0xeb]);
	});
});

describe('Machine', () => {
	it('reset establishes the documented memory map and register state', () => {
		machine.reset();
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['PC']).toBe(MEMORY_MAP.code.base);
		expect(regs['SP']).toBe(MEMORY_MAP.stack.base + MEMORY_MAP.stack.size);
		expect(regs['R0']).toBe(0);
		expect(CODE_END).toBe(0x40000);
	});

	// Regression: remapping regions per reset exposed engine-heap garbage
	// (C1FFFFFF...) in code memory. Code memory must be deterministic:
	// the program, a UDF terminator, then the fill pattern (zeros with a
	// UDF word every 16 words — required to keep translation blocks small,
	// see the engine limitation note in machine.ts).
	it('code memory beyond the program is deterministic across repeated loads', () => {
		const UDF = [0xf0, 0x00, 0xf0, 0xe7];
		const long = assembleOk('.rept 32\n\tmov r0, #1\n.endr'); // 128 bytes
		const short = assembleOk('mov r0, #5'); // 4 bytes
		machine.loadProgram(long);
		machine.step(2);
		machine.loadProgram(short); // must wipe the longer previous program
		// terminator right after the program
		expect(Array.from(machine.readMemory(MEMORY_MAP.code.base + 4, 4))).toEqual(UDF);
		// then the fill pattern: zeros except a UDF at each 16th word
		const rest = machine.readMemory(MEMORY_MAP.code.base, 1024);
		for (let w = 2; w < 256; w++) {
			const word = Array.from(rest.slice(w * 4, w * 4 + 4));
			expect(word, `word ${w}`).toEqual(w % 16 === 15 ? UDF : [0, 0, 0, 0]);
		}
	});

	// Execution is stopped BEFORE it leaves the program's bytes: letting
	// the CPU raise a real exception (e.g. executing the UDF terminator)
	// permanently damages this engine build — afterwards, rewritten code
	// keeps executing stale translation blocks.
	it('stepping past the program end reports a clean error without executing', () => {
		machine.loadProgram(assembleOk('mov r0, #5'));
		expect(machine.step(1).ok).toBe(true);
		const result = machine.step(1); // would land on the UDF terminator
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('left the program');
		}
	});

	it('the machine stays healthy after an out-of-program stop', () => {
		machine.loadProgram(assembleOk('mov r0, #5'));
		machine.step(1);
		expect(machine.step(1).ok).toBe(false); // out-of-program error
		// A new program at the same address must actually execute
		// (stale-translation-block regression check).
		machine.loadProgram(assembleOk('mov r7, #9\nb .'));
		machine.snapshotRegisters();
		expect(machine.step(1).ok).toBe(true);
		const r7 = machine.snapshotRegisters().find((r) => r.name === 'R7')!;
		expect(r7.value).toBe(9);
		expect(r7.changed).toBe(true);
	});

	it('loadProgram writes the program to code memory', () => {
		const bytes = assembleOk('mov r0, #5');
		machine.loadProgram(bytes);
		expect(Array.from(machine.readMemory(MEMORY_MAP.code.base, 4))).toEqual(
			Array.from(bytes),
		);
	});

	it('step executes a single instruction and advances PC', () => {
		machine.loadProgram(assembleOk('mov r0, #5'));
		const result = machine.step(1);
		expect(result.ok).toBe(true);
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R0']).toBe(5);
		expect(regs['PC']).toBe(MEMORY_MAP.code.base + 4);
	});

	it('executes the default loop program (add, mul, branch back)', () => {
		machine.loadProgram(
			assembleOk('Loop:\n\tadd r0, r0, #1\n\tmul r1, r0, r0\n\tb Loop'),
		);
		machine.step(1); // add
		machine.step(1); // mul
		machine.step(1); // b Loop
		let regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R0']).toBe(1);
		expect(regs['R1']).toBe(1);
		expect(regs['PC']).toBe(MEMORY_MAP.code.base); // branched back

		machine.step(1); // add again
		regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R0']).toBe(2);
	});

	// Guest loads/stores were broken in the old vendored 2017 unicorn.js
	// build; @alexaltea/unicorn-js 2.x (WASM) fixed them. This test guards
	// the capability that memory-mapped peripherals depend on.
	it('stack memory is usable (push/pop round-trip)', () => {
		machine.loadProgram(
			assembleOk('mov r0, #42\npush {r0}\nmov r0, #0\npop {r1}'),
		);
		const result = machine.step(4);
		expect(result.ok).toBe(true);
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R1']).toBe(42);
		expect(regs['SP']).toBe(MEMORY_MAP.stack.base + MEMORY_MAP.stack.size);
	});

	// Regression: the engine leaves a stale PC when emu_stop() fires right
	// after a taken branch (new translation block); Machine must land on
	// the branch target, not re-execute the branch.
	it('single-stepping follows branches, calls and stack returns', () => {
		machine.loadProgram(
			assembleOk(
				'main:\n\tbl func\n\tmov r3, r0\nhang:\n\tb hang\nfunc:\n\tpush {lr}\n\tmov r0, #7\n\tpop {pc}',
			),
		);
		const pcAfter = (label: string, expected: number) => {
			machine.step(1);
			expect(machine.pc(), label).toBe(expected);
		};
		pcAfter('bl -> func', 0x1000c); // branched to func
		pcAfter('push {lr}', 0x10010);
		pcAfter('mov r0, #7', 0x10014);
		pcAfter('pop {pc} -> return', 0x10004); // returned via stack
		machine.step(1); // mov r3, r0
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R3']).toBe(7);
		expect(regs['SP']).toBe(MEMORY_MAP.stack.base + MEMORY_MAP.stack.size);
		pcAfter('b hang (self-loop)', 0x10008);
	});

	// Fast path for Run mode: many instructions per engine call. Safe
	// because all reachable translation blocks are kept small (see the
	// engine limitation note in machine.ts).
	it('run() executes an instruction batch in one engine call', () => {
		machine.loadProgram(
			assembleOk('Loop:\n\tadd r0, r0, #1\n\tmul r1, r0, r0\n\tb Loop'),
		);
		const result = machine.run(3000); // exactly 1000 loop iterations
		expect(result.ok).toBe(true);
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R0']).toBe(1000);
		expect(regs['R1']).toBe(1000 * 1000);
		expect(regs['PC']).toBe(MEMORY_MAP.code.base); // stopped at loop top
	});

	it('run() reports errors when execution leaves the program', () => {
		machine.loadProgram(assembleOk('mov r0, #5\nmov r1, #6'));
		const result = machine.run(1000); // falls off the program end
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('left the program');
		}
		// Both instructions executed before the stop.
		const regs = Object.fromEntries(
			machine.snapshotRegisters().map((r) => [r.name, r.value]),
		);
		expect(regs['R1']).toBe(6);
	});

	it('run() sustains large batches quickly', () => {
		machine.loadProgram(
			assembleOk('Loop:\n\tadd r0, r0, #1\n\tsubs r2, r0, r0\n\tb Loop'),
		);
		const started = performance.now();
		const result = machine.run(600_000);
		const elapsed = performance.now() - started;
		expect(result.ok).toBe(true);
		const r0 = machine.snapshotRegisters().find((r) => r.name === 'R0')!;
		expect(r0.value).toBe(200_000);
		expect(elapsed, `600k instructions took ${elapsed.toFixed(0)}ms`).toBeLessThan(5000);
	});

	it('snapshotRegisters flags changed registers exactly once', () => {
		machine.loadProgram(assembleOk('mov r7, #9'));
		machine.snapshotRegisters(); // settle baseline after reset
		machine.step(1);
		const first = machine.snapshotRegisters().find((r) => r.name === 'R7')!;
		expect(first.changed).toBe(true);
		const second = machine.snapshotRegisters().find((r) => r.name === 'R7')!;
		expect(second.changed).toBe(false);
	});

	// Starting emu_start at an unfetchable PC livelocks the engine build,
	// so step() refuses out-of-code PCs before touching the engine.
	it('reports an error result for a PC outside code memory', () => {
		machine.reset();
		machine.cpu.regWrite(uc.ARM_REG_PC, 0x100000);
		const result = machine.step(1);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('outside code memory');
		}
	});

	it('reports an error result when a wild branch lands outside code memory', () => {
		// bx to unmapped memory: the engine throws (mid-run fetch faults
		// correctly, unlike starting there), and step() reports it.
		machine.loadProgram(assembleOk('mov r1, #0x100000\nbx r1'));
		expect(machine.step(1).ok).toBe(true);
		const result = machine.step(1);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('Invalid memory fetch');
		}
	});
});

describe('hexdump', () => {
	it('formats rows with offsets, hex, ascii and marker word', () => {
		const bytes = new Uint8Array(32);
		bytes[0] = 0x41; // 'A'
		bytes[1] = 0x00;
		const rows = hexdump(bytes, 0x10000, 0x10000);
		expect(rows.length).toBe(2);
		expect(rows[0].offset).toBe('0x00010000');
		expect(rows[0].bytes[0].hex).toBe('41');
		expect(rows[0].bytes[0].ascii).toBe('A');
		expect(rows[0].bytes[1].ascii).toBe('.');
		// Marker word (PC/SP) covers the first 4 bytes only.
		expect(rows[0].bytes.slice(0, 4).every((b) => b.marked)).toBe(true);
		expect(rows[0].bytes[4].marked).toBe(false);
		expect(rows[1].bytes.every((b) => !b.marked)).toBe(true);
	});

	it('flags bytes that differ from the previous snapshot', () => {
		const previous = new Uint8Array([0, 0, 0, 0]);
		const current = new Uint8Array([0, 0x2a, 0, 0]);
		const rows = hexdump(current, 0xff00, 0, 16, previous);
		expect(rows[0].bytes.map((b) => b.changed)).toEqual([false, true, false, false]);
	});

	it('flags nothing without a previous snapshot', () => {
		const rows = hexdump(new Uint8Array([1, 2, 3]), 0, 0);
		expect(rows[0].bytes.every((b) => !b.changed)).toBe(true);
	});

	it('dims aligned words matching dimWord (the code fill pattern)', () => {
		// word 0: real instruction bytes; word 1: the UDF fill word
		const bytes = new Uint8Array([0x05, 0x00, 0xa0, 0xe3, 0xf0, 0x00, 0xf0, 0xe7]);
		const rows = hexdump(bytes, 0x10000, 0, 16, undefined, 0xe7f000f0);
		const dimColor = rows[0].bytes[7].color;
		expect(rows[0].bytes.slice(4, 8).every((b) => b.color === dimColor)).toBe(true);
		expect(rows[0].bytes[3].color).not.toBe(dimColor); // instruction stays lit
		expect(rows[0].bytes[3].hex).toBe('E3');
		expect(rows[0].bytes[4].hex).toBe('F0'); // hex still shown, just dim
	});
});
