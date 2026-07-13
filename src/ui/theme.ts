import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// Port of the CodeMirror 5 "OakSim" theme (base16-ish, dark).
export const oakTheme: Extension = [
	EditorView.theme(
		{
			'&': {
				backgroundColor: 'transparent',
				color: '#e0e0e0',
				height: '100%',
				fontSize: '12px',
			},
			'.cm-content': {
				fontFamily: 'courier, monospace',
				caretColor: '#b0b0b0',
			},
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: '#b0b0b0' },
			'.cm-gutters': {
				backgroundColor: 'transparent',
				border: 'none',
				color: '#505050',
			},
			'.cm-activeLine': { backgroundColor: '#20202080' },
			'.cm-activeLineGutter': { backgroundColor: 'transparent' },
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
				{ backgroundColor: '#303030' },
		},
		{ dark: true },
	),
	syntaxHighlighting(
		HighlightStyle.define([
			{ tag: tags.comment, color: '#8f5536' },
			{ tag: tags.number, color: '#aa759f' },
			{ tag: tags.atom, color: '#aa759f' },
			{ tag: tags.string, color: '#f4bf75' },
			{ tag: tags.keyword, color: '#ac4142' },
			{ tag: tags.tagName, color: '#ac4142' },
			{ tag: tags.variableName, color: '#90a959' },
			{ tag: tags.special(tags.variableName), color: '#6a9fb5' },
			{ tag: tags.standard(tags.variableName), color: '#d28445' },
			{ tag: tags.definition(tags.variableName), color: '#d28445' },
			{ tag: tags.bracket, color: '#e0e0e0' },
		]),
	),
];
