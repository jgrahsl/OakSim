import type { Assembler } from './assembler';

/**
 * Locates the source line of the first syntax error. Keystone reports no
 * line numbers, so the line is found by assembling source prefixes: a
 * syntax error on line N makes every prefix that includes N fail with a
 * syntax-class error, while shorter prefixes either assemble or fail
 * only with symbol-resolution errors (forward references cut off by the
 * truncation). That makes "prefix fails syntactically" monotone in the
 * prefix length, so a binary search finds the first bad line in
 * O(log n) assemblies.
 *
 * Returns null when the failure is purely about unresolved symbols
 * (no syntactic line to blame) or the search is inconclusive.
 */

/** Symbol-resolution failures are not syntax errors. */
function isSyntaxFailure(assembler: Assembler, source: string, address: number): boolean {
	const result = assembler.assemble(source, address);
	return !result.ok && !/symbol/i.test(result.message);
}

export function findErrorLine(
	assembler: Assembler,
	source: string,
	address: number,
): number | null {
	const lines = source.split('\n');
	const prefix = (i: number) => lines.slice(0, i + 1).join('\n');

	if (!isSyntaxFailure(assembler, source, address)) {
		return null;
	}
	// Smallest i whose prefix fails syntactically.
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (isSyntaxFailure(assembler, prefix(mid), address)) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}
	return lo;
}
