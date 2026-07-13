<script lang="ts">
	import { onMount } from 'svelte';
	import { basicSetup } from 'codemirror';
	import { EditorView, Decoration } from '@codemirror/view';
	import { StateEffect, StateField, type Extension } from '@codemirror/state';
	import { StreamLanguage } from '@codemirror/language';
	import { gas } from '@codemirror/legacy-modes/mode/gas';
	import { oakTheme } from './theme';

	let {
		value,
		onchange,
		pcLine = null,
	}: {
		value: string;
		onchange: (source: string) => void;
		/** 0-based source line to mark as the current PC line. */
		pcLine?: number | null;
	} = $props();

	// Line decoration marking the instruction at PC.
	const setPcLine = StateEffect.define<number | null>();
	const pcLineMark = Decoration.line({ class: 'cm-pc-line' });
	const pcLineField: Extension = StateField.define({
		create: () => Decoration.none,
		update(marks, tr) {
			marks = marks.map(tr.changes);
			for (const effect of tr.effects) {
				if (effect.is(setPcLine)) {
					if (effect.value === null || effect.value >= tr.state.doc.lines) {
						marks = Decoration.none;
					} else {
						const line = tr.state.doc.line(effect.value + 1);
						marks = Decoration.set([pcLineMark.range(line.from)]);
					}
				}
			}
			return marks;
		},
		provide: (field) => EditorView.decorations.from(field),
	});

	let host: HTMLDivElement;
	let view: EditorView | undefined;

	onMount(() => {
		view = new EditorView({
			doc: value,
			extensions: [
				basicSetup,
				StreamLanguage.define(gas),
				oakTheme,
				pcLineField,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						onchange(update.state.doc.toString());
					}
				}),
			],
			parent: host,
		});
		view.focus();
		return () => view?.destroy();
	});

	$effect(() => {
		view?.dispatch({ effects: setPcLine.of(pcLine) });
	});
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		height: 100%;
	}
	.editor :global(.cm-editor) {
		height: 100%;
	}
	.editor :global(.cm-pc-line) {
		background: rgba(106, 159, 181, 0.16);
	}
</style>
