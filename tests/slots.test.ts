import { describe, it, expect, beforeAll } from 'vitest';

// Program-slot persistence. state.ts binds `storage` at import time, so
// install a localStorage stub before importing it.
const backing = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (k: string) => backing.get(k) ?? null,
	setItem: (k: string, v: string) => void backing.set(k, String(v)),
	removeItem: (k: string) => void backing.delete(k),
	clear: () => backing.clear(),
} satisfies Partial<Storage>;

const state = await import('../src/state');

beforeAll(() => {
	state.initState();
});

describe('program slots', () => {
	it('starts on the default program', () => {
		expect(state.currentProgram()).toBe(state.DEFAULT_PROGRAM);
	});

	it('numbered slots autosave and restore their content', () => {
		state.selectSlot(0);
		state.sourceChanged('mov r0, #1');
		expect(state.selectSlot('default')).toBe(state.DEFAULT_PROGRAM);
		expect(state.selectSlot(0)).toBe('mov r0, #1');
	});

	it('the default program cannot be altered', () => {
		state.selectSlot('default');
		state.sourceChanged('@ scribbled over the demo');
		state.selectSlot(1); // switching away must NOT save into default
		expect(state.selectSlot('default')).toBe(state.DEFAULT_PROGRAM);
	});

	it('the active slot and its content survive a reload', () => {
		state.selectSlot(1);
		state.sourceChanged('mov r2, #2');
		state.initState(); // simulates a page load
		expect(state.currentProgram()).toBe('mov r2, #2');
	});

	it('empty slots come up with a placeholder comment', () => {
		expect(state.selectSlot(3)).toContain('Program 3');
	});
});
