import type { Assembler } from './assembler';

/**
 * Maps code addresses back to source lines, for highlighting the line at
 * PC in the editor.
 *
 * Keystone returns only bytes, so the mapping is recovered with a shadow
 * assembly: the source is re-assembled with a unique `.word` marker
 * injected after every line, and the bytes between consecutive markers
 * are the bytes that line contributed. Branch encodings are fixed-size on
 * ARM, so the injected words shift addresses without changing what each
 * line emits. The result is validated against the real program length —
 * on any inconsistency (marker collision with data, `.rept` blocks
 * replicating markers, alignment directives coarser than 4) the map is
 * discarded and no line is highlighted, rather than a wrong one.
 */

const MARKER_BASE = 0x0bad0000;

export interface LineRange {
	/** 0-based source line. */
	line: number;
	/** [start, end) address range of the bytes this line emitted. */
	start: number;
	end: number;
}

export function buildLineMap(
	assembler: Assembler,
	source: string,
	baseAddress: number,
	programLength: number,
): LineRange[] | null {
	const lines = source.split('\n');
	if (lines.length >= 0x10000) return null;
	const shadowSource = lines
		.map((line, i) => `${line}\n.word ${MARKER_BASE + i}`)
		.join('\n');
	const shadow = assembler.assemble(shadowSource, baseAddress);
	if (!shadow.ok) return null;

	const view = new DataView(
		shadow.bytes.buffer,
		shadow.bytes.byteOffset,
		shadow.bytes.byteLength,
	);
	const ranges: LineRange[] = [];
	let address = baseAddress;
	let expected = 0;
	let segmentStart = 0;
	// Markers can sit at any byte offset (data directives emit unaligned
	// segments), so scan byte-wise for each expected marker in turn.
	while (expected < lines.length) {
		let found = -1;
		for (let offset = segmentStart; offset + 4 <= shadow.bytes.length; offset++) {
			if (view.getUint32(offset, true) === MARKER_BASE + expected) {
				found = offset;
				break;
			}
		}
		if (found < 0) break;
		const size = found - segmentStart;
		if (size > 0) {
			ranges.push({ line: expected, start: address, end: address + size });
			address += size;
		}
		segmentStart = found + 4;
		expected++;
	}

	// Validation: every marker found, and the code accounted for between
	// markers plus the trailing remainder (literal pools are emitted after
	// the final statement in both assemblies) matches the real program.
	if (expected !== lines.length) return null;
	const trailing = shadow.bytes.length - segmentStart;
	if (address - baseAddress + trailing !== programLength) return null;
	return ranges;
}

/** 0-based source line whose bytes contain `address`, or null. */
export function lineAt(ranges: LineRange[], address: number): number | null {
	for (const range of ranges) {
		if (address >= range.start && address < range.end) {
			return range.line;
		}
	}
	return null;
}
