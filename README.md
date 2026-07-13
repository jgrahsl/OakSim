# OakSim

OakSim is a prototype front-end ARM assembler and Simulator that works entirely from within your browser!

## [Live web page here!](https://wunkolo.github.io/OakSim/)

## Development

Vite + TypeScript + Svelte; the emulator core is framework-free (`src/core/`).

```sh
npm install
npm run dev       # dev server with HMR
npm run test      # unit tests (Vitest)
npm run check     # svelte-check / TypeScript
npm run build     # static site in dist/
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — repo structure, running locally, code structure and module interaction
- [docs/PERIPHERALS.md](docs/PERIPHERALS.md) — peripheral (MMIO) extension design and the Motorola 6845 CRTC plan
- [docs/MODERNIZATION.md](docs/MODERNIZATION.md) — refactor plan for a modern, maintainable web stack

![](http://i.imgur.com/EytaXHz.gif)

![](http://i.imgur.com/uHjrYT2.gif)

---

OakSim uses the assembler framework [Keystone](https://github.com/keystone-engine/keystone) and the CPU emulator framework [Unicorn](https://github.com/unicorn-engine/unicorn) which are both licensed under the GPLv2 license. These frameworks have been ported into a Javascript API [Unicorn.js](https://github.com/AlexAltea/unicorn.js) and [Keystone.js](https://github.com/AlexAltea/keystone.js) via Emscripten by [AlexAltea](https://github.com/AlexAltea).

