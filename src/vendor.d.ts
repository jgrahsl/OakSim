// @alexaltea/unicorn-js ships no TypeScript types. Each per-architecture
// subpath exports an async Emscripten factory resolving to the engine
// namespace (constants + Unicorn class).
declare module '@alexaltea/unicorn-js/arm' {
	const MUnicorn: (moduleArg?: object) => Promise<any>;
	export default MUnicorn;
}
