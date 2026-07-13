import { Cpu } from './cpu';
import { uc } from './engine';
import type { Peripheral } from '../peripherals/peripheral';

/**
 * Memory-mapped I/O bus: owns one MMIO address window, backed by plain
 * RAM plus a read hook and a write hook, and dispatches guest accesses to
 * the attached peripherals by address.
 *
 * Read semantics: Unicorn read hooks fire before the load and cannot
 * substitute the loaded value, so the hook writes the device's current
 * value into the backing memory at the accessed address — the CPU's load
 * then picks it up (verified in tests/mmio.test.ts).
 */
export class Bus {
	private devices: Peripheral[] = [];

	constructor(
		private cpu: Cpu,
		readonly base: number,
		readonly size: number,
	) {
		cpu.memMap(base, size, uc.PROT_READ | uc.PROT_WRITE);
		const end = base + size - 1;

		cpu.hookAdd(
			uc.HOOK_MEM_WRITE,
			(_e: unknown, _type: number, address: bigint, accessSize: number, value: bigint) => {
				const addr = Number(address);
				const device = this.deviceAt(addr);
				device?.write(addr - device.base, Number(value), accessSize);
			},
			null,
			base,
			end,
		);

		cpu.hookAdd(
			uc.HOOK_MEM_READ,
			(_e: unknown, _type: number, address: bigint, accessSize: number) => {
				const addr = Number(address);
				const device = this.deviceAt(addr);
				if (!device) return;
				const value = device.read(addr - device.base, accessSize) >>> 0;
				const bytes = new Uint8Array(accessSize);
				for (let i = 0; i < accessSize; i++) {
					bytes[i] = (value >>> (8 * i)) & 0xff;
				}
				this.cpu.memWrite(addr, bytes);
			},
			null,
			base,
			end,
		);
	}

	attach(device: Peripheral): void {
		if (device.base < this.base || device.base + device.size > this.base + this.size) {
			throw new Error(`${device.name} does not fit inside the MMIO window`);
		}
		this.devices.push(device);
	}

	reset(): void {
		for (const device of this.devices) {
			device.reset();
		}
	}

	private deviceAt(address: number): Peripheral | undefined {
		return this.devices.find(
			(d) => address >= d.base && address < d.base + d.size,
		);
	}
}
