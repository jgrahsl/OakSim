/**
 * Engine capability tests for memory-mapped I/O — the foundation the
 * peripheral bus (docs/PERIPHERALS.md) will build on. These exercise the
 * raw Cpu/engine surface, not a Bus implementation (which doesn't exist
 * yet); if they break, peripherals break.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Assembler } from '../src/core/assembler';
import { Cpu } from '../src/core/cpu';
import { uc } from '../src/core/engine';

const CODE_BASE = 0x10000;
const MMIO_BASE = 0x70000;

let assembler: Assembler;

beforeAll(() => {
	assembler = new Assembler();
});

function program(source: string): Uint8Array {
	const result = assembler.assemble(source, CODE_BASE);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('unreachable');
	return result.bytes;
}

describe('MMIO capability (engine level)', () => {
	it('write hook observes a guest store with address, size and value', () => {
		const cpu = new Cpu();
		cpu.memMap(CODE_BASE, 0x1000, uc.PROT_ALL);
		cpu.memMap(MMIO_BASE, 0x1000, uc.PROT_READ | uc.PROT_WRITE);

		const writes: { address: number; size: number; value: number }[] = [];
		cpu.hookAdd(
			uc.HOOK_MEM_WRITE,
			(_engine: unknown, _type: number, address: bigint, size: number, value: bigint) => {
				writes.push({ address: Number(address), size, value: Number(value) });
			},
			null,
			MMIO_BASE,
			MMIO_BASE + 0xfff,
		);

		const bytes = program('mov r0, #0x11\nmov r1, #0x70000\nstr r0, [r1, #4]');
		cpu.memWrite(CODE_BASE, bytes);
		cpu.emuStart(CODE_BASE, CODE_BASE + bytes.length);

		expect(writes).toEqual([{ address: MMIO_BASE + 4, size: 4, value: 0x11 }]);
	});

	it('read hook can supply a device value via the backing-memory preload trick', () => {
		const cpu = new Cpu();
		cpu.memMap(CODE_BASE, 0x1000, uc.PROT_ALL);
		cpu.memMap(MMIO_BASE, 0x1000, uc.PROT_READ | uc.PROT_WRITE);

		cpu.hookAdd(
			uc.HOOK_MEM_READ,
			(_engine: unknown, _type: number, address: bigint) => {
				// A device would compute its register value here.
				cpu.memWrite(Number(address), new Uint8Array([0x99, 0, 0, 0]));
			},
			null,
			MMIO_BASE,
			MMIO_BASE + 0xfff,
		);

		const bytes = program('mov r1, #0x70000\nldr r2, [r1, #4]');
		cpu.memWrite(CODE_BASE, bytes);
		cpu.emuStart(CODE_BASE, CODE_BASE + bytes.length);

		expect(cpu.regRead(uc.ARM_REG_R2)).toBe(0x99);
	});

	it('hooks outside the MMIO range do not fire for ordinary RAM access', () => {
		const cpu = new Cpu();
		cpu.memMap(CODE_BASE, 0x1000, uc.PROT_ALL);
		cpu.memMap(0x40000, 0x1000, uc.PROT_READ | uc.PROT_WRITE);
		cpu.memMap(MMIO_BASE, 0x1000, uc.PROT_READ | uc.PROT_WRITE);

		let fired = 0;
		cpu.hookAdd(
			uc.HOOK_MEM_WRITE,
			() => {
				fired++;
			},
			null,
			MMIO_BASE,
			MMIO_BASE + 0xfff,
		);

		const bytes = program('mov r0, #7\nmov r1, #0x40000\nstr r0, [r1]');
		cpu.memWrite(CODE_BASE, bytes);
		cpu.emuStart(CODE_BASE, CODE_BASE + bytes.length);

		expect(fired).toBe(0);
		expect(Array.from(cpu.memRead(0x40000, 4))).toEqual([7, 0, 0, 0]);
	});
});
