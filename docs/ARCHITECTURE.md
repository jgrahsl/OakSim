# OakSim Architecture

OakSim is a browser-based ARM assembler and simulator. There is no backend:
the app builds to a fully static site. As of the 2026 refactor it is a
Vite + TypeScript + Svelte application with a framework-free emulator core.

- **Assembler:** [Keystone](https://github.com/keystone-engine/keystone)
  as WASM via the npm package
  [`keystone-wasm`](https://www.npmjs.com/package/keystone-wasm)
- **CPU emulator:** [Unicorn 2](https://github.com/unicorn-engine/unicorn)
  as WASM via the npm package
  [`@alexaltea/unicorn-js`](https://github.com/AlexAltea/unicorn.js)
  (ARM-only bundle, async Emscripten factory)
- **Editor:** CodeMirror 6 (npm packages) with the GAS legacy syntax mode
- **UI:** Svelte 5; **build:** Vite; **tests:** Vitest

The pre-refactor app (a single 431-line ES5 file, `js/OakSim.js`, with
vendored CodeMirror 5) is preserved in git history before commit tagged by
this refactor.

## Repository structure

```
OakSim/
├── index.html                  Vite entry: loads vendor scripts + src/main.ts
├── package.json                Scripts: dev / build / preview / test / check
├── vite.config.ts              base './' (GitHub Pages), Vitest config
├── svelte.config.js, tsconfig.json
├── .npmrc                      Public npm registry for this project
├── src/
│   ├── main.ts                 Awaits both WASM inits, then mounts the app
│   ├── app.css                 Global layout/panel styling (dark theme)
│   ├── state.ts                Stores + actions; owns Machine/Assembler
│   ├── vendor.d.ts             Module declaration for unicorn-js
│   ├── core/                   Framework-free emulator core (unit-tested)
│   │   ├── engine.ts           Unicorn WASM init; exports the `uc` namespace
│   │   ├── types.ts            RegisterSnapshot, StepResult, AssembleResult
│   │   ├── assembler.ts        Keystone WASM init + Assembler wrapper
│   │   ├── cpu.ts              Wraps a Unicorn instance (only module doing so)
│   │   ├── bus.ts              MMIO window: routes guest loads/stores to devices
│   │   ├── machine.ts          Memory map, reset/load/step, snapshots
│   │   └── hexdump.ts          Pure hexdump formatting (structured data)
│   ├── peripherals/
│   │   ├── peripheral.ts       Device contract (read/write/reset over MMIO)
│   │   ├── mc6845.ts           Motorola 6845 CRTC register model
│   │   └── mc6821-kbd.ts       Apple I-style PIA keyboard (ASCII FIFO)
│   └── ui/                     Svelte components (no direct core access)
│       ├── App.svelte          Layout: header, editor column, panels column
│       ├── Editor.svelte       CodeMirror 6 wrapper (GAS mode, OakSim theme)
│       ├── Toolbar.svelte      Run/Step/Reset + run-delay input
│       ├── Registers.svelte    Register table with change highlighting
│       ├── HexPane.svelte      Reusable hexdump panel (marker underline +
│       │                       changed-byte highlighting); used for the
│       │                       code view (PC) and the stack view (SP)
│       ├── Console.svelte      Diagnostics/messages panel
│       └── theme.ts            CodeMirror theme (port of the CM5 theme)
├── tests/
│   ├── setup.ts                Initializes both WASM engines for Node
│   ├── core.test.ts            Assembler/Machine/hexdump unit tests
│   └── mmio.test.ts            MMIO hook capability tests (peripheral base)
├── examples/
│   └── stack.s                 Guided stack demo (push/pop, call/return)
├── SampleCode.s                Example assembly exercising directives
└── docs/                       This documentation
```

## Running locally

```sh
npm install       # once
npm run dev       # dev server with HMR, http://localhost:5173
npm run test      # Vitest unit tests (runs the real Keystone/Unicorn in Node)
npm run check     # svelte-check / TypeScript
npm run build     # static production build in dist/
npm run preview   # serve dist/ locally
```

Notes:

- `.npmrc` points this project at the public npm registry
  (`registry.npmjs.org`) — all dependencies are public packages.
- TypeScript is pinned to 5.x; `svelte-check` cannot load the TS 7
  native-compiler package as a library.
- The build output in `dist/` is a plain static site (relative `base`), so it
  can be served from any static host or sub-path, e.g. GitHub Pages.

## Code structure

### Layering

```
┌────────────────────────────────────────────────┐
│ src/ui/*.svelte      components, presentation  │
├────────────────────────────────────────────────┤
│ src/state.ts         stores + actions          │
│  owns: Machine, Assembler, run loop, debounce  │
├────────────────────────────────────────────────┤
│ src/core/*           framework-free, testable  │
│  machine.ts → cpu.ts → engine.ts (Unicorn 2)   │
│  assembler.ts → global `ks` (Keystone)         │
└────────────────────────────────────────────────┘
```

Startup is async: `main.ts` awaits `initEngine()` (WASM instantiation),
then calls `initState()` (constructs Machine/Assembler, assembles the
default program) before mounting the UI.

Rules that keep this maintainable:

- **Components never touch the core.** They subscribe to read-only stores
  from `state.ts` and call its exported actions (`step`, `toggleRun`,
  `reset`, `sourceChanged`).
- **Only `cpu.ts` talks to Unicorn instances, only `assembler.ts` talks to
  Keystone.** (`engine.ts` owns engine init and the constants namespace.)
  This is what made the 2026 engine swap — vendored 2017 asm.js build →
  Unicorn 2 WASM from npm — a three-file change.
- **The core returns data, never HTML.** `hexdump.ts` produces structured
  rows; `machine.snapshotRegisters()` produces `{name, value, changed}`
  records. Rendering decisions live in components.
- **Unicorn is the single source of truth** for machine state; the UI holds
  no emulation state beyond previous-value tracking for change highlighting.

### The core

**`machine.ts`** defines the guest memory map and the machine lifecycle:

| Range | Size | Protection | Purpose |
|---|---|---|---|
| `0x08000 – 0x10000` | 32 KiB | RW | Stack (descending; SP starts at `0x10000`) |
| `0x10000 – 0x40000` | 192 KiB | RWX | Code (programs load at `0x10000`, PC starts here) |
| `0x40000 – 0x60000` | 128 KiB | RW | Working RAM |
| `0x60000 – 0x70000` | 64 KiB | RW | Video RAM (text cells scanned by the CRTC) |
| `0x70000 – 0x71000` | 4 KiB | RW+hooks | MMIO window (peripheral registers, Bus-dispatched) |

`reset()` wipes the loaded program (restoring the code fill pattern),
zeroes registers, and resets attached peripherals; `loadProgram()` is
reset + write + UDF terminator; `step(n)` single-steps with
`until = pc+4` and `run(budget)` batch-executes (see the engine notes),
both converting engine exceptions into `StepResult` values. Devices in
the MMIO window: the MC6845 CRTC at `0x70000` (`+0` address register,
`+4` data register; text buffer in VRAM at `0x60000`, 2 bytes per cell)
and the MC6821 keyboard at `0x70010` (`+0` data pops the FIFO, `+4`
status bit 7 = key ready).

**`assembler.ts`** assembles GAS-syntax ARM source at a given load address
(the code base is passed in, so literal pools and absolute references
resolve correctly — an improvement over the pre-refactor app, which
assembled at address 0).

### State and data flow

```
 editor keystrokes       125 ms debounce
 Editor.svelte ─ onchange ───────────────► state.assembleNow()
                                              │ Assembler.assemble(src, 0x10000)
                                              │ ok → Machine.loadProgram(bytes)
                                              │      + buildLineMap (PC line highlight)
                                              │ err → assembleError store
                                              ▼
 Toolbar: Step/Run ──► state.step() ──► Machine.step(1)     (per-instruction)
 Toolbar: Fast ──────► state loop ────► Machine.run(batch)  (per rAF frame)
                                              │
                                              ▼
                                     state.refresh() / refreshCrt()
                        registers/hexdump/crt stores ◄── machine snapshots
                                              │
                                              ▼
                        Registers / HexPane / CrtDisplay re-render
 CRT-canvas keystrokes ──► state.keyInput() ──► keyboard FIFO (no refresh)
```

Run modes: **Run** auto-steps one instruction per interval tick (the delay
field, min 50 ms effective) with full pane updates — the debugging mode.
**Fast** executes adaptive batches (~10 ms of emulation per animation
frame, tens of millions of instructions/sec); per frame only the CRT store
refreshes, and the debug panes sync once when the run stops. Errors from
either mode land in the messages store and stop the run.

Program slots: the editor's content belongs to the active slot (toolbar:
two immutable built-ins from `examples/` plus Pgm 0–3). Numbered slots
autosave to localStorage on every edit; the active slot is persisted, so
reloading the page restores the program being worked on.

Behavior preserved from the original app: continuous re-assembly on edit
(which also resets the machine), register change highlighting, PC-word
underline in the memory view. The code-memory window is 256 bytes at
`0x10000` (`MEMORY_VIEW_BYTES` in `state.ts`).

Added after the refactor: a stack panel showing the top 256 bytes of the
stack region (`0xFF00`–`0xFFFF` — the stack descends from `0x10000`, so
that is where pushes land), with the SP word underlined and bytes that
changed since the previous refresh highlighted. Window constants live in
`state.ts` (`STACK_VIEW_BYTES`/`STACK_VIEW_BASE`).

Fixed during the refactor: the per-reset hook leak, `classList` misuse,
unescaped `innerHTML` injection (Svelte escapes text), assembler errors now
shown in the UI instead of only the browser console.

## Engine notes (Unicorn 2 WASM, `@alexaltea/unicorn-js` 2.1.4)

History: the previously vendored 2017 unicorn.js 1.x asm.js build could not
execute *any* guest memory-access instruction (`ldr`/`str`/`push`/`pop`/
`ldm`/`stm` aborted TCG translation) — verified in both Node and Chrome, so
the original OakSim deployment had the same limitation. The 2026 swap to
the Unicorn 2.1.4 WASM npm package fixed this and unblocked memory-mapped
peripherals; `tests/mmio.test.ts` guards the MMIO hook capabilities the
peripheral bus depends on.

Facts about the current engine that the code works around or relies on:

- **Async init:** the package exports an Emscripten factory
  (`const uc = await MUnicorn()`); `src/core/engine.ts` owns this and
  exposes the resolved namespace as a live binding.
- **Giant translation blocks are lethal (the central limitation).**
  Stopping execution (via `emu_stop()` from a hook, or the engine's own
  count-stop — which is the same mechanism internally) inside a
  translation block longer than ~33 instructions traps the WASM runtime
  ("memory access out of bounds") and leaves the engine unusable.
  Translation blocks end at branches/UDF, so zero-filled memory (zeros
  decode as `andeq` no-ops) forms one giant block — the pre-refactor
  garbage in remapped pages accidentally *prevented* this by decoding as
  invalid instructions. Mitigations in `machine.ts`:
  - unused code memory is filled with zeros plus a **UDF word every 16
    words**, and a UDF terminator follows the loaded program, so every
    reachable block stays small (and running past the program end gives
    a clean "Invalid instruction" error);
  - programs with a **straight-line run > 32 instructions** are rejected
    at load time (`longestStraightRun()` — data pools count, so a huge
    pool can false-positive);
  - stepping passes **`until = pc + 4`** to `emu_start`, which caps
    translation at the next instruction — sequential steps stop by
    address without `emu_stop()` ever firing mid-block. Taken branches
    are caught by a persistent `HOOK_CODE` hook that stops at the first
    address ≠ the stepped instruction (or its second visit, for `b .`
    self-loops) and writes that address back to PC (the engine can leave
    a stale PC on hook-initiated stops).
- **Starting `emu_start` at an unfetchable address livelocks** (a mid-run
  branch to one throws `UC_ERR_FETCH_UNMAPPED` correctly); `step()`/`run()`
  refuse PCs outside code memory before touching the engine.
- **Execution is confined to the loaded program's bytes.** The code hook
  stops execution *before* it leaves the program, because letting the CPU
  raise a real exception (e.g. executing the UDF terminator) permanently
  damages the engine — afterwards rewritten code executes stale
  translation blocks. Falling off the end or jumping outside the program
  yields a clean "execution left the program" error.
- **Plain rewrites don't reliably invalidate multi-instruction
  translation blocks**, so `reset()` unmaps + remaps the code region
  (dropping its blocks) and fully refills it with the pattern — remapped
  pages come back with recycled garbage otherwise. Bulk `mem_write` is
  fine (192 KiB in ~0.1 ms). RAM regions stay mapped and keep their
  contents across reset (warm-reset semantics, like real DRAM).
- **Run mode batches instructions**: `Machine.run(budget)` executes up to
  `budget` instructions in one `emu_start` call via the hook's countdown
  (~tens of millions of instructions/sec), while `step()` pays one
  engine round-trip per instruction. The UI uses `run()` in an
  animation-frame loop when the run delay is 0, sized adaptively to
  ~10 ms of emulation per frame.
- **BigInt at the hook boundary:** 64-bit quantities (addresses, written
  values) arrive in hook callbacks as `BigInt`; convert with `Number(...)`.
- **Read hooks fire before the load** and cannot substitute the loaded
  value; MMIO reads use the preload trick — write the device's value into
  backing memory inside the hook so the CPU's load picks it up (verified in
  `tests/mmio.test.ts`).
- **CPSR writes are sanitized** by the engine (writing 0 yields `0x13`,
  SVC mode), so blanket register zeroing in `reset()` is safe.
- The instance API mirrors classic unicorn.js: `mem_map`, `mem_unmap`,
  `mem_read`, `mem_write`, `reg_read_i32`/`reg_write_i32` (+ typed
  variants), `emu_start`, `emu_stop`, `hook_add`, `hook_del`, `close`.

## Assembler notes (Keystone WASM, `keystone-wasm`)

History: the previously vendored 2017 `keystone.min.js` encoded **every
`bl label` as a branch-to-self** (`0xEBFFFFFE`), forward or backward, near
or far — so function calls never worked in OakSim (plain and conditional
`b` were fine, which hid the bug: the default demo only uses `b`). It
surfaced when the stack demo's `bl square` looped forever; regression
tests for both `bl` directions live in `tests/core.test.ts`.

The replacement, `keystone-wasm` (npm, TypeScript types included), is an
async WASM module: `initAssembler()` awaits `loadKeystone()` before an
`Assembler` may be constructed — same pattern as the Unicorn engine, both
awaited in `main.ts`/`tests/setup.ts`. `asm(source, { address })` returns
a `Uint8Array` and throws on error (wrapped into `AssembleResult`). One
packaging quirk: its `exports` map lacks a `types` condition, so
`tsconfig.json` maps the module to its `.d.ts` via `paths`.
