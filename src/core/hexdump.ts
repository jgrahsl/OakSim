/**
 * Pure formatting of a memory block into hexdump rows. Returns structured
 * data; the UI decides how to render it (no HTML strings in the core).
 */

export interface DumpByte {
	hex: string;
	ascii: string;
	color: string;
	/** Kinds of the markers whose 4-byte word contains this byte (e.g.
	 *  'pc', 'sp', 'fp', 'cursor'); empty when unmarked. */
	markers: string[];
	/** True when this byte differs from the `previous` snapshot. */
	changed: boolean;
}

export interface DumpRow {
	offset: string;
	bytes: DumpByte[];
}

/** Base16-ish accent palette; byte value picks a color. */
const COLORS = ['#e0e0e0', '#90a959', '#6a9fb5', '#ac4142', '#aa759f', '#f4bf75'];
const ZERO_COLOR = '#313032';

export interface HexMarker {
	/** The marker's 4-byte word ([address, address+4)) is highlighted. */
	address: number;
	/** Style key; HexPane maps it to a color (e.g. 'pc', 'sp', 'fp'). */
	kind: string;
}

export interface HexdumpOptions {
	/** Addresses to highlight (PC, SP, FP, cursor, ...). */
	markers?: HexMarker[];
	/** Bytes per row. */
	width?: number;
	/** Previous snapshot; differing bytes are flagged as changed. */
	previous?: Uint8Array;
	/** Aligned words with this value render dimmed like zero bytes (used
	 *  for the code region's UDF fill pattern — background, not data). */
	dimWord?: number;
}

/**
 * Base address of the page-aligned view window (pageSize bytes) that
 * contains `address`, clamped to stay inside the region. Addresses
 * outside the region clamp to its first/last page — e.g. the initial SP
 * one past the stack's top shows the topmost page.
 */
export function pageBase(
	address: number,
	regionBase: number,
	regionSize: number,
	pageSize: number,
): number {
	const lastPage = regionBase + regionSize - pageSize;
	if (address < regionBase) return regionBase;
	if (address >= regionBase + regionSize) return lastPage;
	return Math.min(
		lastPage,
		regionBase + Math.floor((address - regionBase) / pageSize) * pageSize,
	);
}

export function hexdump(
	bytes: Uint8Array,
	baseAddress: number,
	options: HexdumpOptions = {},
): DumpRow[] {
	const { markers = [], width = 16, previous, dimWord } = options;
	const dimmed = new Uint8Array(bytes.length);
	if (dimWord !== undefined) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
			if (view.getUint32(offset, true) === (dimWord >>> 0)) {
				dimmed.fill(1, offset, offset + 4);
			}
		}
	}
	const rows: DumpRow[] = [];
	for (let rowStart = 0; rowStart < bytes.length; rowStart += width) {
		const row: DumpByte[] = [];
		for (let i = rowStart; i < Math.min(rowStart + width, bytes.length); i++) {
			const value = bytes[i];
			const address = baseAddress + i;
			const printable = value > 31 && value < 127;
			row.push({
				hex: value.toString(16).toUpperCase().padStart(2, '0'),
				ascii: printable && !dimmed[i] ? String.fromCharCode(value) : '.',
				color:
					value === 0 || dimmed[i] ? ZERO_COLOR : COLORS[value % COLORS.length],
				markers: markers
					.filter((m) => m.address <= address && address < m.address + 4)
					.map((m) => m.kind),
				changed: previous !== undefined && previous[i] !== value,
			});
		}
		rows.push({
			offset: '0x' + (baseAddress + rowStart).toString(16).toUpperCase().padStart(8, '0'),
			bytes: row,
		});
	}
	return rows;
}
