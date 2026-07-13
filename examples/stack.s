@ --- Stack demo -------------------------------------------------
@ Watch the SP register and the "Stack top" panel while stepping.
@ The stack grows DOWNWARD from 0x10000, so pushed values appear in
@ the bottom rows of the panel and creep upward as you push more.

main:
	mov	r0, #0x41	@ 'A' - printable, shows in the ASCII column
	mov	r1, #0x42	@ 'B'
	mov	r2, #0x43	@ 'C'

	push	{r0}		@ SP: 0x10000 -> 0xFFFC, 'A' lands there
	push	{r1}		@ SP -> 0xFFF8, 'B'
	push	{r2}		@ SP -> 0xFFF4, 'C' (last pushed = lowest address)

	mov	r0, #0		@ wipe all three registers...
	mov	r1, #0
	mov	r2, #0

	pop	{r0}		@ ...restore: LIFO order, so r0 = 'C', not 'A'!
	pop	{r1}		@ r1 = 'B'
	pop	{r2}		@ r2 = 'A'; SP is back at 0x10000

	mov	r0, #5
	bl	square		@ call: LR = return address, r0 = argument
	mov	r3, r0		@ r3 = 25

	b	done

@ A function using the stack the standard way: the prologue saves
@ what it clobbers (r4) plus the return address; the epilogue
@ returns by popping the saved LR straight into PC.
square:
	push	{r4, lr}	@ two words: SP -> 0xFFF8
	mov	r4, r0
	mul	r0, r4, r4
	pop	{r4, pc}	@ restore r4 AND return in one instruction

done:
	b	done		@ park here; press Reset to start over
