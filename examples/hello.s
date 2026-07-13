@ --- MC6845 CRT demo --------------------------------------------
@ Programs the CRT controller (registers via the MMIO address/data
@ pair at 0x70000), then writes "hello world" into video memory at
@ row 5, column 5, and leaves a blinking cursor after the text.

	ldr	r0, =0x70000		@ CRTC: +0 address reg, +4 data reg
	ldr	r1, =CrtcTable
InitLoop:
	ldrb	r2, [r1], #1		@ register index (0xFF = end of table)
	cmp	r2, #0xFF
	beq	WriteText
	str	r2, [r0]		@ select CRTC register
	ldrb	r3, [r1], #1
	str	r3, [r0, #4]		@ write its value
	b	InitLoop

WriteText:
	ldr	r1, =Message
	ldr	r3, =0x6019A		@ VRAM cell (5*40+5)*2: row 5, col 5
CopyLoop:
	ldrb	r2, [r1], #1		@ next character (0 = done)
	cmp	r2, #0
	beq	Done
	strb	r2, [r3], #1		@ character byte
	mov	r4, #0x0A		@ attribute: bright green
	strb	r4, [r3], #1
	b	CopyLoop
Done:
	b	Done			@ park here

CrtcTable:				@ pairs of (register, value)
	.byte	1, 40			@ R1  columns displayed
	.byte	6, 25			@ R6  rows displayed
	.byte	9, 7			@ R9  scanlines per row - 1
	.byte	10, 0x40		@ R10 cursor: blink, start line 0
	.byte	11, 7			@ R11 cursor end line
	.byte	12, 0			@ R12 display start (hi)
	.byte	13, 0			@ R13 display start (lo)
	.byte	14, 0			@ R14 cursor address (hi)
	.byte	15, 216			@ R15 cursor address: 5*40+16
	.byte	0xFF, 0xFF
	.balign	4
Message:
	.asciz	"hello world"
	.balign	4
