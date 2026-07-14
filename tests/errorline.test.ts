import { describe, it, expect, beforeAll } from 'vitest';
import { Assembler } from '../src/core/assembler';
import { findErrorLine } from '../src/core/errorline';
import { MEMORY_MAP } from '../src/core/machine';

const BASE = MEMORY_MAP.code.base;

let assembler: Assembler;

beforeAll(() => {
	assembler = new Assembler();
});

const find = (source: string) => findErrorLine(assembler, source, BASE);

describe('findErrorLine', () => {
	it('finds a bad mnemonic on the first line', () => {
		expect(find('bogus r0, r1\nmov r0, #1')).toBe(0);
	});

	it('finds a bad line in the middle', () => {
		expect(find('mov r0, #1\nmov r1, #2\nfrobnicate r3\nmov r2, #3')).toBe(2);
	});

	it('finds a bad operand on the last line', () => {
		expect(find('mov r0, #1\nmov r1, #2\nmov r2, [r1]')).toBe(2); // malformed operand
	});

	it('is not fooled by forward references before the error', () => {
		// The `bl func` forward ref makes early prefixes fail with a
		// symbol error, which must not be mistaken for the syntax error.
		expect(find('bl func\nmov r0, #1\nnotaninsn r9\nfunc:\nmov r0, #2')).toBe(2);
	});

	it('returns null for undefined-symbol-only failures', () => {
		expect(find('b nowhere')).toBeNull();
	});

	it('returns null for programs that assemble', () => {
		expect(find('mov r0, #1')).toBeNull();
	});
});
