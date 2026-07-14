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
		errorLine = null,
	}: {
		value: string;
		onchange: (source: string) => void;
		/** 0-based source line to mark as the current PC line. */
		pcLine?: number | null;
		/** 0-based source line to mark as the first syntax error. */
		errorLine?: number | null;
	} = $props();

	/** A line decoration driven by a number-or-null effect. */
	function lineMark(cssClass: string) {
		const set = StateEffect.define<number | null>();
		const mark = Decoration.line({ class: cssClass });
		const field: Extension = StateField.define({
			create: () => Decoration.none,
			update(marks, tr) {
				marks = marks.map(tr.changes);
				for (const effect of tr.effects) {
					if (effect.is(set)) {
						if (effect.value === null || effect.value >= tr.state.doc.lines) {
							marks = Decoration.none;
						} else {
							const line = tr.state.doc.line(effect.value + 1);
							marks = Decoration.set([mark.range(line.from)]);
						}
					}
				}
				return marks;
			},
			provide: (f) => EditorView.decorations.from(f),
		});
		return { set, field };
	}

	const pcMark = lineMark('cm-pc-line');
	const errorMark = lineMark('cm-error-line');

	let host: HTMLDivElement;
	let view: EditorView | undefined;

	/** Replace the whole document (used when switching program slots). */
	export function setContent(text: string): void {
		view?.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: text },
		});
	}

	onMount(() => {
		view = new EditorView({
			doc: value,
			extensions: [
				basicSetup,
				StreamLanguage.define(gas),
				oakTheme,
				pcMark.field,
				errorMark.field,
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
		view?.dispatch({ effects: pcMark.set.of(pcLine) });
	});

	$effect(() => {
		view?.dispatch({ effects: errorMark.set.of(errorLine) });
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
		background: rgba(106, 159, 181, 0.28);
	}
	.editor :global(.cm-error-line) {
		background: rgba(172, 65, 66, 0.45);
	}
</style>
