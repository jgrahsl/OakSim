# Extending OakSim with Peripherals

Goal: let assembly programs running in the simulator talk to devices —
starting with a Motorola 6845 CRT controller (CRTC) driving a visible text
display — through memory-mapped I/O (MMIO), the way real ARM SoCs expose
peripherals.

> **Status: IMPLEMENTED (2026-07).** The bus (`src/core/bus.ts`), the
> peripheral contract (`src/peripherals/peripheral.ts`), the MC6845
> (`src/peripherals/mc6845.ts`), and the CRT panel
> (`src/ui/CrtDisplay.svelte`) are live; the default program writes
> "hello world" to the display and enables a blinking cursor.
> `tests/peripherals.test.ts` covers bus dispatch, the 6845 register
> protocol, and the end-to-end demo. The design below matches the
> implementation; deviations are noted inline. To add a new device:
> implement `Peripheral`, `machine.attachPeripheral(device)` in
> `initState()`, and add a panel component reading a snapshot store.

## Why MMIO, and what Unicorn gives us

ARM has no separate I/O port space; peripherals live in the physical address
space. Unicorn supports exactly this pattern via memory hooks:

- `hook_add(uc.HOOK_MEM_WRITE, cb, null, begin, end)` — called on every store
  into `[begin, end]`, with the address, access size, and value. This is how a
  device observes register writes.
- `hook_add(uc.HOOK_MEM_READ, cb, null, begin, end)` — called **before** a
  load. Unicorn.js cannot substitute the loaded value from the callback, so
  reads with side effects use the standard trick: in the read hook, compute
  the device's current register value and `mem_write()` it into the backing
  memory at that address, so the CPU's actual load picks it up.

So an MMIO region is: a normal `mem_map`-ed region (backing store) plus a
read hook and a write hook covering it, dispatching to device models.

The current memory map ends at `0x60000`; everything above is unmapped.
Proposed extension:

| Range | Size | Purpose |
|---|---|---|
| `0x60000 – 0x70000` | 64 KiB | Video RAM (plain RAM, scanned by the CRTC) |
| `0x70000 – 0x71000` | 4 KiB | MMIO window (all device registers) |

VRAM is deliberately *plain memory* — no hooks needed; programs write
characters into it at full speed and the renderer reads it when drawing a
frame. Only the small register window is hooked.

## Proposed peripheral framework

Keep the emulator core in charge of one MMIO window and let devices register
sub-ranges. Sketch (written against the current code style; in the
modernized codebase these become TypeScript classes/interfaces — see
[MODERNIZATION.md](MODERNIZATION.md)):

```js
// A device implements:
//   base, size          — where it sits inside the MMIO window
//   read(offset, size)  — return current register value (pure w.r.t. CPU)
//   write(offset, value, size)
//   reset()
//   tick(steps)         — optional: advance device time
//   render()            — optional: update its UI panel

function Bus(unicorn, mmioBase, mmioSize) {
    var devices = [];
    unicorn.mem_map(mmioBase, mmioSize, uc.PROT_READ | uc.PROT_WRITE);

    function deviceAt(addr) { /* find device with base <= addr < base+size */ }

    // Unicorn 2 hook signature: 64-bit address/value arrive as BigInt.
    unicorn.hook_add(uc.HOOK_MEM_WRITE,
        function (engine, type, address, size, value) {
            var addr = Number(address);
            var d = deviceAt(addr);
            if (d) d.write(addr - d.base, Number(value), size);
        }, null, mmioBase, mmioBase + mmioSize - 1);

    unicorn.hook_add(uc.HOOK_MEM_READ,
        function (engine, type, address, size) {
            var addr = Number(address);
            var d = deviceAt(addr);
            if (!d) return;
            // Pre-load trick: place the device's value into backing RAM
            var v = d.read(addr - d.base, size);
            unicorn.mem_write(addr, encodeLE(v, size));
        }, null, mmioBase, mmioBase + mmioSize - 1);

    this.attach = function (device) { devices.push(device); };
    this.reset  = function () { devices.forEach(d => d.reset()); };
    this.tick   = function (n) { devices.forEach(d => d.tick && d.tick(n)); };
}
```

Integration points in the refactored code:

1. **`src/core/machine.ts`** — extend `MEMORY_MAP` with the VRAM region,
   construct the `Bus` (new `src/core/bus.ts`) with the MMIO window, and
   call `bus.reset()` from `Machine.reset()`. Install the bus hooks once at
   construction, not per reset.
2. **`Machine.step()`** — after a successful `emu_start`, call
   `bus.tick(n)` so devices with time-dependent behavior (vsync, timers,
   UART baud) advance. Since "Run" mode executes 1 instruction per UI tick,
   device time is best modeled in *instructions executed*, not wall-clock
   time.
3. **`src/state.ts` `refresh()`** — publish device snapshots to stores the
   same way registers/memory are published; devices expose their state as
   data (e.g. the 6845's register file + a rendered cell grid), components
   render it.
4. **UI** — each device with a visual presence gets its own Svelte
   component under `src/ui/` (for the 6845: a `<canvas>`-based
   `CrtDisplay.svelte`).
5. **Tests** — device models are plain TypeScript; register-protocol tests
   (address/data writes → register file state) run in Vitest without the
   emulator, and end-to-end MMIO tests join `tests/core.test.ts` once the
   engine upgrade lands.

Other peripherals then fit the same mold: a UART (one data register +
status register, rendering to a terminal panel), a timer (raises `HOOK_INTR`
material later), GPIO/LED bank, keyboard (status+data registers fed from DOM
key events).

## The Motorola 6845 CRTC

### What the chip actually is

The MC6845 is not a video card — it's an address/timing generator. It has 18
internal registers (R0–R17) and exposes a **2-register bus interface**:

| Offset | Write | Read |
|---|---|---|
| `+0` | Address register (select R0–R17) | — |
| `+1` | Data into selected register | Data from selected register (R12–R17 only readable on the real chip) |

The registers that matter for a usable emulation:

| Reg | Name | Role in emulation |
|---|---|---|
| R0–R3 | Horizontal total/displayed/sync | Timing — mostly ignorable, R1 = **columns displayed** |
| R4–R8 | Vertical total/adjust/displayed/sync, interlace | R6 = **rows displayed** |
| R9 | Max scanline | Character cell height − 1 |
| R10/R11 | Cursor start/end scanline | Cursor shape + blink mode (R10 bits 5–6) |
| R12/R13 | Start address (hi/lo) | VRAM offset of top-left character — enables hardware scrolling |
| R14/R15 | Cursor address (hi/lo) | Cursor position in VRAM |
| R16/R17 | Light pen (hi/lo) | Read-only; can stub |

The 6845 emits a stream of VRAM addresses (`MA0–MA13`) and row-scanline
counts (`RA0–RA4`); external hardware (character ROM + shift register, as in
the IBM MDA/CGA, BBC Micro, Amstrad CPC) turns that into pixels. For OakSim
this means we also choose the "surrounding hardware" convention. Recommended:
**MDA-like text mode** — each character cell is 2 bytes in VRAM (character
code + attribute byte), rendered through a bundled 8×8 or 8×16 bitmap font
onto a `<canvas>`.

### Proposed device model

```
MMIO:  0x70000  CRTC address register  (write: select 0–17)
       0x70004  CRTC data register     (read/write selected register)
VRAM:  0x60000  text buffer, 2 bytes/cell (char, attr), laid out linearly
```

(Word-spaced registers suit ARM's `str`/`ldr`; byte-packed at `+0`/`+1` with
`strb` would be more period-accurate — pick one and document it. Word-spaced
is friendlier for hand-written ARM assembly.)

Device behavior:

- `write(0, v)` → `addrReg = v & 0x1F`
- `write(4, v)` → `R[addrReg] = v & maskFor(addrReg)`; mark display dirty
- `read(4)` → `R[addrReg]` (optionally restrict to R12–R17 for authenticity)
- `render()` → if dirty (register change **or** VRAM change since last
  frame): compute geometry `cols = R1`, `rows = R6`,
  `charHeight = R9 + 1`, `start = (R12 << 8) | R13`, then read
  `cols * rows * 2` bytes of VRAM from `0x60000 + start * 2` (wrapping) via
  `mem_read`, and blit glyphs to the canvas. Draw the cursor from
  R10/R11/R14/R15, honoring the blink mode using a frame counter from
  `tick()`.
- `tick(n)` → advance a frame/blink counter (instruction-count based).

Cheap VRAM dirty-tracking: add one more `HOOK_MEM_WRITE` over the VRAM range
whose callback only sets `vramDirty = true` (don't hook reads — reads of
plain RAM should stay at full speed and don't need interception).

### Demo program (acceptance test)

A sample program should ship with the feature, e.g.:

```asm
    ldr   r0, =0x70000      @ CRTC base
    mov   r1, #1            @ R1: horizontal displayed
    str   r1, [r0]
    mov   r2, #40           @ 40 columns
    str   r2, [r0, #4]
    mov   r1, #6            @ R6: vertical displayed
    str   r1, [r0]
    mov   r2, #25           @ 25 rows
    str   r2, [r0, #4]

    ldr   r3, =0x60000      @ VRAM
    mov   r4, #'H'
    strb  r4, [r3]          @ character
    mov   r4, #0x07
    strb  r4, [r3, #1]      @ attribute
    ...
```

Milestones:

1. **Bus + null device** — writes/reads to the MMIO window round-trip through
   `read`/`write` callbacks (verify with the register panel + a test program).
2. **6845 register file** — address/data protocol works; register values
   inspectable in a new "Devices" debug panel.
3. **Canvas text renderer** — VRAM + geometry registers produce a live
   display; hardware scrolling via R12/R13 works.
4. **Cursor + blink** — R10/R11/R14/R15 honored, driven by `tick()`.
5. **Sample program + docs** — a `SampleCRTC.s` demo and a register cheat
   sheet in the UI.

### Known constraints

- **Read-value substitution:** Unicorn.js read hooks can't return the value
  directly; the write-into-backing-memory trick (above) is the workaround.
  Registers whose *read has side effects* (not an issue for the 6845) would
  need `HOOK_MEM_READ_AFTER` cleanup or careful design.
- **Hook performance:** each hooked access crosses the JS↔Emscripten
  boundary. Keep the MMIO window small and never hook VRAM reads.
- **Timing fidelity:** OakSim executes ~1 instruction per 50+ ms UI tick; the
  6845's real raster timing (HSYNC/VSYNC, R0/R2/R3/R4/R5/R7) can't be
  meaningfully emulated against wall-clock time. Treat the display as
  "rendered once per refresh" and model blink/frame counters in instruction
  counts. If interrupt-driven vsync is wanted later, it needs the
  modernized run loop (batched `emu_start` with instruction budgets).
