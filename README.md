# OakSim

OakSim is an ARM assembler and simulator that works entirely from within your browser.
There is no backend: it builds to a static site.

This is a fork of [Wunkolo/OakSim](https://github.com/Wunkolo/OakSim), rewritten in 2026
as a Vite + TypeScript + Svelte application with memory-mapped peripherals. The original
2017 version is still live at [wunkolo.github.io/OakSim](https://wunkolo.github.io/OakSim/).

## Features

- **Live assembly:** edit GAS-syntax ARM assembly and it re-assembles as you type; the
  first syntax error is highlighted in the editor.
- **Three ways to execute:** single-step, a stepped run with a configurable delay, or a
  Fast run at tens of millions of instructions per second.
- **Debug views:** registers with change highlighting, the source line at PC, and
  hexdump panes for code, stack, data and character memory. The stack pane marks SP, FP,
  the saved LR and the active frame.
- **Peripherals:** an MC6845 CRT controller rendering a 40×25 text display, an MC6821
  keyboard, and a millisecond timer with a sleep countdown.
- **Program slots:** three built-in demos (hello, keyboard, timer) plus four slots that
  autosave to browser storage and survive reloads.

The emulated CPU is a Cortex-A15 (ARMv7-A), so `udiv`/`sdiv` are available.

## Memory map

| Range | Purpose |
|---|---|
| `0x08000 – 0x10000` | Stack (descending; SP starts at `0x10000`) |
| `0x10000 – 0x40000` | Code (programs load and start at `0x10000`) |
| `0x40000 – 0x60000` | Working RAM |
| `0x60000 – 0x70000` | Video RAM (2 bytes per text cell) |
| `0x70000` | MC6845 CRTC: `+0` address register, `+4` data register |
| `0x70010` | MC6821 keyboard: `+0` data, `+4` status (bit 7 = key ready) |
| `0x70020` | Timer: `+0` millisecond counter, `+4` countdown |

The programs in [`examples/`](examples/) show each peripheral in use.

## Development

The emulator core is framework-free (`src/core/`) and unit-tested against the real
Keystone and Unicorn WASM builds.

```sh
npm install
npm run dev       # dev server with HMR
npm run test      # unit tests (Vitest)
npm run check     # svelte-check / TypeScript
npm run build     # static site in dist/
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — repo structure, code structure, and the engine limitations the core works around
- [docs/PERIPHERALS.md](docs/PERIPHERALS.md) — peripheral (MMIO) extension design and the Motorola 6845 CRTC
- [docs/MODERNIZATION.md](docs/MODERNIZATION.md) — the refactor plan behind the 2026 rewrite

---

OakSim uses the assembler framework [Keystone](https://github.com/keystone-engine/keystone) and the CPU emulator framework [Unicorn](https://github.com/unicorn-engine/unicorn), which are both licensed under the GPLv2 license. They run here as WebAssembly via the npm packages [`keystone-wasm`](https://www.npmjs.com/package/keystone-wasm) and [`@alexaltea/unicorn-js`](https://github.com/AlexAltea/unicorn.js).
