import { mount } from 'svelte';
import App from './ui/App.svelte';
import { initEngine } from './core/engine';
import { initAssembler } from './core/assembler';
import { initState } from './state';
import './app.css';

// Both WASM modules (Unicorn emulator, Keystone assembler) must be
// instantiated before the core exists.
await Promise.all([initEngine(), initAssembler()]);
initState();

const app = mount(App, {
	target: document.getElementById('app')!,
});

export default app;
