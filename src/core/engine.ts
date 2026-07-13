/**
 * Unicorn 2 engine module (@alexaltea/unicorn-js, WASM). The package
 * exports an async Emscripten factory; `initEngine()` must resolve before
 * any core class is constructed. `uc` is a live binding: after init it
 * holds the engine namespace (constants + the Unicorn class).
 */
import MUnicorn from '@alexaltea/unicorn-js/arm';

export let uc: any;

export async function initEngine(): Promise<void> {
	uc ??= await MUnicorn();
}
