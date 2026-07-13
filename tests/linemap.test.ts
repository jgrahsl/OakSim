import { describe, it, expect, beforeAll } from 'vitest';
import { Assembler } from '../src/core/assembler';
import { buildLineMap, lineAt } from '../src/core/linemap';
import { MEMORY_MAP } from '../src/core/machine';
import { DEFAULT_PROGRAM } from '../src/state';

const BASE = MEMORY_MAP.code.base;

let assembler: Assembler;

beforeAll(() => {
	assembler = new Assembler();
});

function mapFor(source: string) {
	const result = assembler.assemble(source, BASE);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('unreachable');
	return { map: buildLineMap(assembler, source, BASE, result.bytes.length), length: result.bytes.length };
}

describe('buildLineMap', () => {
	it('maps addresses to lines for plain instructions', () => {
		const { map } = mapFor('mov r0, #1\nmov r1, #2\nmov r2, #3');
		expect(map).not.toBeNull();
		expect(lineAt(map!, BASE)).toBe(0);
		expect(lineAt(map!, BASE + 4)).toBe(1);
		expect(lineAt(map!, BASE + 8)).toBe(2);
	});

	it('skips labels, blanks and comments', () => {
		const source = '@ comment\nmov r0, #1\n\nLoop:\nadd r0, r0, #1\nb Loop';
		const { map } = mapFor(source);
		expect(map).not.toBeNull();
		expect(lineAt(map!, BASE)).toBe(1); // mov
		expect(lineAt(map!, BASE + 4)).toBe(4); // add (line 3 is the label)
		expect(lineAt(map!, BASE + 8)).toBe(5); // b Loop
	});

	it('handles data directives and multi-byte lines', () => {
		const source = 'ldr r0, =0x12345678\nb .\nTable:\n.byte 1, 2, 3, 4\n.asciz "hey"';
		const { map } = mapFor(source);
		expect(map).not.toBeNull();
		expect(lineAt(map!, BASE)).toBe(0); // ldr
		expect(lineAt(map!, BASE + 8)).toBe(3); // .byte data
		expect(lineAt(map!, BASE + 12)).toBe(4); // .asciz
	});

	it('maps the default program consistently', () => {
		const { map, length } = mapFor(DEFAULT_PROGRAM);
		expect(map).not.toBeNull();
		// Ranges are sorted, non-overlapping, and within the program.
		let last: number = BASE;
		for (const range of map!) {
			expect(range.start).toBeGreaterThanOrEqual(last);
			expect(range.end).toBeGreaterThan(range.start);
			last = range.end;
		}
		expect(last).toBeLessThanOrEqual(BASE + length);
		// The first instruction maps to the first ldr line.
		const firstLine = lineAt(map!, BASE)!;
		expect(DEFAULT_PROGRAM.split('\n')[firstLine]).toContain('ldr');
	});

	it('degrades to null rather than guessing (e.g. .rept blocks)', () => {
		const source = '.rept 3\nmov r0, #1\n.endr';
		const result = assembler.assemble(source, BASE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const map = buildLineMap(assembler, source, BASE, result.bytes.length);
		expect(map).toBeNull();
	});
});
