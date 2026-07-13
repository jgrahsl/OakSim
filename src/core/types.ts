export interface RegisterSnapshot {
	name: string;
	/** Unsigned 32-bit value. */
	value: number;
	/** True if the value differs from the previous snapshot. */
	changed: boolean;
}

export type StepResult = { ok: true } | { ok: false; message: string };

export type AssembleResult =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; message: string };
