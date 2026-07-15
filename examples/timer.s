@ --- Timer demo: a star walks across the screen ------------------
@ Uses the timer (0x70020: +0 free-running ms counter, +4 countdown)
@ to sleep 100 ms between animation frames on the MC6845 CRT.
@ Run with Fast: the sleep is wall-clock, so the pace stays 100 ms.

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
	ldr	r4, =0x70020		@ timer
	ldr	r6, =0x60000		@ VRAM (2 bytes per cell)
	ldr	r5, =480		@ cell: row 12, column 0
Loop:
	add	r3, r6, r5, lsl #1	@ draw the star
	mov	r2, #'*'
	strb	r2, [r3]
	mov	r2, #0x0B		@ attribute: bright cyan
	strb	r2, [r3, #1]

	mov	r1, #100		@ sleep 100 ms
	str	r1, [r4, #4]
Wait:
	ldr	r1, [r4, #4]		@ remaining ms
	cmp	r1, #0
	bne	Wait

	mov	r2, #' '		@ erase it
	strb	r2, [r3]
	add	r5, r5, #1		@ next column
	ldr	r1, =520		@ end of row 12? wrap around
	cmp	r5, r1
	ldreq	r5, =480
	b	Loop

CrtcTable:				@ pairs of (register, value)
	.byte	1, 40			@ R1  columns
	.byte	6, 25			@ R6  rows
	.byte	9, 7			@ R9  scanlines per row - 1
	.byte	10, 0x20		@ R10 cursor off
	.byte	0xFF, 0xFF
	.balign	4
