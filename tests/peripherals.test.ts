import { describe, it, expect, beforeAll } from 'vitest';
import { Assembler } from '../src/core/assembler';
import { Machine, MEMORY_MAP } from '../src/core/machine';
import { Mc6845 } from '../src/peripherals/mc6845';
import { Mc6821Keyboard } from '../src/peripherals/mc6821-kbd';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Peripheral } from '../src/peripherals/peripheral';
import { DEFAULT_PROGRAM } from '../src/state';

let assembler: Assembler;
let machine: Machine;
let crtc: Mc6845;
let keyboard: Mc6821Keyboard;

class FakeDevice implements Peripheral {
	readonly name = 'fake';
	readonly size = 8;
	log: string[] = [];
	value = 0x55;
	constructor(readonly base: number) {}
	read(offset: number, size: number): number {
		this.log.push(`r${offset}/${size}`);
		return this.value;
	}
	write(offset: number, value: number, size: number): void {
		this.log.push(`w${offset}=${value}/${size}`);
	}
	reset(): void {
		this.log.push('reset');
	}
}

let fake: FakeDevice;

beforeAll(() => {
	assembler = new Assembler();
	machine = new Machine();
	crtc = new Mc6845(MEMORY_MAP.mmio.base);
	machine.attachPeripheral(crtc);
	keyboard = new Mc6821Keyboard(MEMORY_MAP.mmio.base + 0x10);
	machine.attachPeripheral(keyboard);
	fake = new FakeDevice(MEMORY_MAP.mmio.base + 0x100);
	machine.attachPeripheral(fake);
});

function run(source: string, steps: number): void {
	const result = assembler.assemble(source, MEMORY_MAP.code.base);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('unreachable');
	machine.loadProgram(result.bytes);
	const stepResult = machine.step(steps);
	expect(stepResult.ok, stepResult.ok ? '' : stepResult.message).toBe(true);
}

describe('Bus', () => {
	it('routes guest stores to the addressed device with offset and value', () => {
		fake.log = [];
		run('ldr r0, =0x70100\nmov r1, #0x2a\nstr r1, [r0, #4]\nb .', 3);
		expect(fake.log).toContain('w4=42/4');
	});

	it('routes guest loads and delivers the device value', () => {
		fake.log = [];
		fake.value = 0x77;
		run('ldr r0, =0x70100\nldr r2, [r0]\nb .', 2);
		expect(fake.log).toContain('r0/4');
		const r2 = machine.snapshotRegisters().find((r) => r.name === 'R2')!;
		expect(r2.value).toBe(0x77);
	});

	it('resets attached devices on machine reset', () => {
		fake.log = [];
		machine.reset();
		expect(fake.log).toContain('reset');
	});

	it('rejects devices outside the MMIO window', () => {
		expect(() => machine.attachPeripheral(new FakeDevice(0x90000))).toThrow();
	});
});

describe('Mc6845', () => {
	it('implements the address/data register protocol', () => {
		crtc.reset();
		crtc.write(0, 1); // select R1
		crtc.write(4, 40);
		crtc.write(0, 6); // select R6
		crtc.write(4, 25);
		crtc.write(0, 1);
		expect(crtc.read(4)).toBe(40);
		const snap = crtc.snapshot();
		expect(snap.cols).toBe(40);
		expect(snap.rows).toBe(25);
	});

	it('masks register writes to their documented widths', () => {
		crtc.reset();
		crtc.write(0, 6); // R6 is 7 bits
		crtc.write(4, 0xff);
		expect(crtc.read(4)).toBe(0x7f);
	});

	it('decodes cursor mode and addresses from R10-R15', () => {
		crtc.reset();
		const set = (reg: number, value: number) => {
			crtc.write(0, reg);
			crtc.write(4, value);
		};
		set(10, 0x40 | 2); // blink, start line 2
		set(11, 6);
		set(14, 0x01);
		set(15, 0x2c);
		set(12, 0x00);
		set(13, 0x10);
		const snap = crtc.snapshot();
		expect(snap.cursorMode).toBe('blink');
		expect(snap.cursorStartLine).toBe(2);
		expect(snap.cursorEndLine).toBe(6);
		expect(snap.cursorAddress).toBe(0x12c);
		expect(snap.startAddress).toBe(0x10);
	});
});

describe('Mc6821Keyboard', () => {
	it('reports status and pops the FIFO in order', () => {
		keyboard.reset();
		expect(keyboard.read(4)).toBe(0); // nothing pending
		keyboard.enqueue(0x68); // 'h'
		keyboard.enqueue(0x20); // ' '
		expect(keyboard.read(4)).toBe(0x80);
		expect(keyboard.read(0)).toBe(0x68);
		expect(keyboard.read(0)).toBe(0x20);
		expect(keyboard.read(4)).toBe(0);
		expect(keyboard.read(0)).toBe(0); // empty reads yield 0
	});

	it('a guest polling loop receives typed keys', () => {
		const result = assembler.assemble(
			'ldr r4, =0x70010\nPoll:\nldr r1, [r4, #4]\ntst r1, #0x80\nbeq Poll\nldr r2, [r4]\nb .',
			MEMORY_MAP.code.base,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		machine.loadProgram(result.bytes); // resets the bus (clears the FIFO)
		keyboard.enqueue('k'.charCodeAt(0)); // then a key arrives
		expect(machine.step(8).ok).toBe(true);
		const r2 = machine.snapshotRegisters().find((r) => r.name === 'R2')!;
		expect(r2.value).toBe('k'.charCodeAt(0));
		expect(keyboard.pending()).toBe(0);
	});

	it('the keyboard example program moves the cursor and stamps X', () => {
		keyboard.reset();
		crtc.reset();
		const source = readFileSync(
			resolve(dirname(fileURLToPath(import.meta.url)), '../examples/keyboard.s'),
			'utf8',
		);
		const result = assembler.assemble(source, MEMORY_MAP.code.base);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		machine.loadProgram(result.bytes);
		// type: l (right), j (down), space (stamp)
		for (const key of 'lj ') keyboard.enqueue(key.charCodeAt(0));
		const stepResult = machine.run(5000);
		expect(stepResult.ok, stepResult.ok ? '' : stepResult.message).toBe(true);
		// cursor: 500 + 1 + 40 = 541
		expect(crtc.snapshot().cursorAddress).toBe(541);
		// X stamped at cell 541
		const cell = machine.readMemory(MEMORY_MAP.vram.base + 541 * 2, 2);
		expect(String.fromCharCode(cell[0])).toBe('X');
		expect(cell[1]).toBe(0x0e);
	});
});

describe('Timer', () => {
	it('counts milliseconds and runs countdowns on the injected clock', async () => {
		const { Timer } = await import('../src/peripherals/timer');
		let clock = 1000;
		const t = new Timer(0x70020, () => clock);
		expect(t.read(0)).toBe(0);
		clock = 1250;
		expect(t.read(0)).toBe(250);
		t.write(4, 100); // arm 100 ms
		expect(t.read(4)).toBe(100);
		clock = 1310;
		expect(t.read(4)).toBe(40);
		clock = 1400;
		expect(t.read(4)).toBe(0); // expired
		expect(t.read(4)).toBe(0);
		t.write(0, 0); // reset the counter
		expect(t.read(0)).toBe(0);
		t.write(4, 50);
		t.reset();
		expect(t.read(4)).toBe(0); // machine reset disarms
	});

	it('a guest sleep loop wakes after the wall-clock duration', async () => {
		const { Timer } = await import('../src/peripherals/timer');
		const t = new Timer(MEMORY_MAP.mmio.base + 0x20);
		machine.attachPeripheral(t);
		const result = assembler.assemble(
			[
				'ldr r0, =0x70020',
				'mov r1, #20',
				'str r1, [r0, #4]', // sleep 20 ms
				'Wait:',
				'ldr r1, [r0, #4]',
				'cmp r1, #0',
				'bne Wait',
				'mov r7, #1', // woke up
				'b .',
			].join('\n'),
			MEMORY_MAP.code.base,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		machine.loadProgram(result.bytes);
		const started = performance.now();
		let woke = false;
		for (let i = 0; i < 200 && !woke; i++) {
			expect(machine.run(500_000).ok).toBe(true);
			woke = machine.snapshotRegisters().find((r) => r.name === 'R7')!.value === 1;
		}
		const elapsed = performance.now() - started;
		expect(woke).toBe(true);
		expect(elapsed).toBeGreaterThanOrEqual(19); // slept at least ~20 ms
	});
});

describe('default hello world program', () => {
	it('programs the CRTC and writes the text into VRAM', () => {
		crtc.reset();
		const result = assembler.assemble(DEFAULT_PROGRAM, MEMORY_MAP.code.base);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		machine.loadProgram(result.bytes);
		// Init loop + copy loop + parking: generously bounded.
		const stepResult = machine.step(300);
		expect(stepResult.ok, stepResult.ok ? '' : stepResult.message).toBe(true);

		const snap = crtc.snapshot();
		expect(snap.cols).toBe(40);
		expect(snap.rows).toBe(25);
		expect(snap.cursorMode).toBe('blink');
		expect(snap.cursorAddress).toBe(5 * 40 + 16); // after the text

		const cellBase = MEMORY_MAP.vram.base + (5 * 40 + 5) * 2;
		const cells = machine.readMemory(cellBase, 'hello world'.length * 2);
		const text = Array.from({ length: 11 }, (_, i) =>
			String.fromCharCode(cells[i * 2]),
		).join('');
		expect(text).toBe('hello world');
		expect(cells[1]).toBe(0x0a); // attribute byte
	});
});
