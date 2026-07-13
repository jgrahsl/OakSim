/**
 * Test environment setup: initialize both WASM engines (Unicorn emulator,
 * Keystone assembler) before any test constructs core objects.
 */
import { initEngine } from '../src/core/engine';
import { initAssembler } from '../src/core/assembler';

await Promise.all([initEngine(), initAssembler()]);
