import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// Relative base so the built site works when served from a sub-path
	// (GitHub Pages project site).
	base: './',
	plugins: [svelte()],
	test: {
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
	},
});
