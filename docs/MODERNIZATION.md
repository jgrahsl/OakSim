# Modernization / Refactor Plan

Goal: make OakSim maintainable and extensible (peripherals, better UI)
without losing what makes it good — a zero-backend, fully in-browser tool.

## Status (2026-07)

Phases 0–2 **and the engine upgrade are done**: the app is Vite +
TypeScript + Svelte 5 + CodeMirror 6 with a framework-free core
(`src/core/`), a Vitest suite (`tests/`), and Unicorn 2.1.4 (WASM, from
npm) as the emulator. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
current structure. Notes:

- CodeMirror 6 landed together with the componentization (no interim CM5
  step); inline assembler error markers are still TODO (errors show in the
  console panel).
- Correctness testing surfaced that the old vendored Unicorn build could
  not execute guest load/store instructions — which would have silently
  blocked all peripheral work. Resolved by the engine upgrade below.
- The assembler was also swapped to a WASM npm package (`keystone-wasm`)
  after the vendored 2017 build turned out to encode every `bl label` as
  a branch-to-self — function calls never worked in the original app.
  Both 2017 vendored blobs are now gone; all engines come from npm.
- **Next up: Phase 3** (peripheral bus + MC6845, see
  [PERIPHERALS.md](PERIPHERALS.md)), now unblocked.

## Engine upgrade track — DONE (2026-07)

Resolved by adopting **`@alexaltea/unicorn-js@2.1.4`** (Unicorn 2.1.4
compiled to WASM by the same author as the original unicorn.js; revived on
npm in 2026 with per-architecture bundles — OakSim uses
`@alexaltea/unicorn-js/arm`). Integration was contained to
`src/core/engine.ts` (new), `src/core/cpu.ts`, `src/core/machine.ts`, and
async startup in `main.ts`/`state.ts`.

Verified on adoption: guest loads/stores work (the old blocker),
range-filtered `HOOK_MEM_READ`/`HOOK_MEM_WRITE` fire correctly for MMIO,
and the read-hook preload trick works (`tests/mmio.test.ts`). One build bug
found and worked around: `emu_start`'s instruction-count stop crashes the
WASM build, so single-stepping uses a `HOOK_CODE` budget + `emu_stop()`
instead (details in ARCHITECTURE.md).

The rejected alternatives, for the record: building Unicorn 2 to WASM
ourselves with Emscripten, or writing a small ARMv4T interpreter in
TypeScript. The latter remains an interesting option if the WASM package
ever becomes a maintenance burden.

## Guiding principles

1. **Core/UI split first, framework second.** The most valuable refactor is
   extracting a framework-agnostic emulator core (assembler, CPU, bus,
   devices) from the DOM code. Once that exists, the UI framework choice is
   low-risk and even swappable.
2. **Unicorn stays the source of truth** for machine state. The UI subscribes
   to snapshots/events; it never owns emulation state.
3. **Incremental.** Each phase leaves a working app deployable to GitHub
   Pages (`vite build` output is still a static site).

## Target stack (recommendation)

| Concern | Current | Proposed |
|---|---|---|
| Language | ES5, one global IIFE | TypeScript, ES modules |
| Build/dev server | none | **Vite** (instant dev server, static `dist/` output) |
| UI framework | hand-built `innerHTML` strings | **Svelte** (or React — see below) |
| Editor | CodeMirror 5.23 (vendored) | **CodeMirror 6** (`@codemirror/*` via npm) |
| Assembler/emulator | vendored keystone.js / unicorn.js (2017 Emscripten builds) | same builds initially, wrapped behind typed interfaces; upgrade to modern WASM builds as a separate track |
| Tests | none | **Vitest** for the core; a couple of Playwright smoke tests |
| Lint/format | none | ESLint + Prettier |

Framework choice: the app is a handful of panels reacting to one state
object; any modern framework works. **Svelte** fits best (tiny runtime,
compiler output suits a GitHub-Pages tool, trivially wraps `<canvas>` for the
CRT display). **React** is the safe alternative if contributor familiarity
matters more. Avoid heavier stacks (Angular, Next.js) — there's no routing,
no SSR, no backend.

The vendored keystone/unicorn builds are pre-WASM asm.js artifacts from
~2017. They work; keep them at first (loaded as classic scripts, exposed to
the typed core through thin wrapper modules that declare `uc`/`ks` globals).
Upgrading to Unicorn 2 / modern WASM builds is worthwhile but is its own
project — schedule it after the refactor, behind the same `Cpu` interface.

## Target structure

```
OakSim/
├── index.html                  Vite entry
├── package.json / vite.config.ts / tsconfig.json
├── public/                     copied as-is (fonts, sample programs)
├── vendor/                     keystone.min.js, unicorn-arm.min.js (+ type shims)
├── src/
│   ├── core/                   framework-free, unit-tested
│   │   ├── assembler.ts        wraps Keystone: asm(src) → bytes | diagnostics
│   │   ├── cpu.ts              wraps Unicorn: regs, memory, step(n), hooks
│   │   ├── machine.ts          memory map, reset, run loop, snapshots
│   │   └── bus.ts              MMIO dispatch (see PERIPHERALS.md)
│   ├── peripherals/
│   │   ├── peripheral.ts       Peripheral interface (read/write/tick/reset)
│   │   └── mc6845.ts           CRTC register file + text renderer model
│   ├── ui/                     components only; no direct Unicorn access
│   │   ├── App.svelte
│   │   ├── Editor.svelte       CodeMirror 6 wrapper
│   │   ├── Registers.svelte
│   │   ├── MemoryView.svelte
│   │   ├── Console.svelte      messages/log panel
│   │   └── CrtDisplay.svelte   <canvas> fed by the mc6845 model
│   └── state.ts                store: machine snapshot + UI prefs
└── tests/                      Vitest specs for core/ and peripherals/
```

Core API sketch (what the UI programs against):

```ts
interface Machine {
  reset(): void;
  loadProgram(bytes: Uint8Array): void;
  step(n: number): StepResult;          // ok | fault(message)
  snapshot(): { regs: RegisterSnapshot; }; 
  readMemory(addr: number, len: number): Uint8Array;
  attach(p: Peripheral): void;
  onAfterStep(cb: (r: StepResult) => void): void;
}
```

## Phased plan

**Phase 0 — Safety net (small).** Add Vite + TypeScript around the *existing*
code without rewriting it: move `OakSim.js` under `src/legacy/`, get
`npm run dev`/`build` working, deploy `dist/` to Pages (GitHub Action). Fix
the known bugs listed in [ARCHITECTURE.md](ARCHITECTURE.md#known-quirks--cleanup-candidates)
(hook leak, `classList` misuse, unescaped `innerHTML`, 1 KiB memory-view
truncation).

**Phase 1 — Extract the core.** Pull `Assembler`, `Cpu`, `Machine` out of the
god-object into `src/core/` with types and Vitest coverage (assemble a known
program → expected bytes; step → expected register deltas; memory map
invariants). The legacy DOM code becomes a thin consumer of the core.

**Phase 2 — Componentize the UI.** Replace the `innerHTML` renderers with
components (registers table, memory hexdump, console, toolbar) and CodeMirror
6 (restores the currently-disabled inline assembler error markers via
diagnostics from `Assembler`). Memory view becomes windowed/virtualized so
showing more than 1 KiB is cheap.

**Phase 3 — Peripheral bus + MC6845.** Implement `bus.ts`,
`peripheral.ts`, and `mc6845.ts` per [PERIPHERALS.md](PERIPHERALS.md), plus
the `CrtDisplay` canvas component and a bundled sample program. This is the
first payoff of the refactor and the acceptance test for the architecture.

**Phase 4 — Quality of life / stretch.** Improved run loop (batch N
instructions per `requestAnimationFrame` with an instruction budget instead
of 1 instruction per `setInterval` tick), program save/load via
`localStorage` + file open (the disabled "Open" button), breakpoints via
`HOOK_CODE`, optional Unicorn 2 / Keystone WASM upgrade, more peripherals
(UART console, timer, GPIO).

## Sequencing note vs. the 6845 goal

If the 6845 is wanted *quickly*, it can be built on today's codebase — the
bus sketch in PERIPHERALS.md is written to drop into `OakSim.js` as-is
(Phase 3 without Phases 0–2). The cost is writing it twice-ish: the device
*model* (register file + renderer logic) should be written as a
self-contained object either way, so it ports to `src/peripherals/mc6845.ts`
unchanged; only the panel/canvas wiring would be redone. Recommended order
remains Phase 0 → 1 → 3 → 2 if the peripheral is the priority.
