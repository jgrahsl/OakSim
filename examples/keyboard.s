@ --- Keyboard demo: move with h j k l, stamp X with space -------
@ Uses the MC6821 keyboard (0x70010: +0 data pops a key, +4 status
@ bit 7 = key ready) and the MC6845 CRT. Click the screen to give it
@ keyboard focus, press Run with delay 0, then type h/j/k/l/space.

	ldr	r0, =0x70000		@ CRTC: +0 address reg, +4 data reg
	ldr	r1, =CrtcTable
Init:
	ldrb	r2, [r1], #1		@ register index (0xFF = end)
	cmp	r2, #0xFF
	beq	Main
	str	r2, [r0]
	ldrb	r3, [r1], #1
	str	r3, [r0, #4]
	b	Init

Main:
	ldr	r4, =0x70010		@ keyboard
	ldr	r6, =0x60000		@ VRAM (2 bytes per cell)
	ldr	r5, =500		@ cursor cell: row 12, col 20
	bl	SetCursor
Poll:
	ldr	r1, [r4, #4]		@ KBDCR
	tst	r1, #0x80		@ key waiting?
	beq	Poll
	ldr	r2, [r4]		@ read it (pops the FIFO)
	cmp	r2, #'h'
	subeq	r5, r5, #1
	cmp	r2, #'l'
	addeq	r5, r5, #1
	cmp	r2, #'k'
	subeq	r5, r5, #40
	cmp	r2, #'j'
	addeq	r5, r5, #40
	cmp	r2, #' '
	bne	Move
	add	r3, r6, r5, lsl #1	@ stamp an X at the cursor cell
	mov	r2, #'X'
	strb	r2, [r3]
	mov	r2, #0x0E		@ attribute: yellow
	strb	r2, [r3, #1]
Move:
	bl	SetCursor
	b	Poll

SetCursor:				@ CRTC R14/R15 = cell in r5
	mov	r1, #14
	str	r1, [r0]
	mov	r1, r5, lsr #8
	str	r1, [r0, #4]
	mov	r1, #15
	str	r1, [r0]
	and	r1, r5, #0xFF
	str	r1, [r0, #4]
	bx	lr

CrtcTable:				@ pairs of (register, value)
	.byte	1, 40			@ R1  columns
	.byte	6, 25			@ R6  rows
	.byte	9, 7			@ R9  scanlines per row - 1
	.byte	10, 0x40		@ R10 cursor: blink
	.byte	11, 7			@ R11 cursor end line
	.byte	0xFF, 0xFF
	.balign	4
