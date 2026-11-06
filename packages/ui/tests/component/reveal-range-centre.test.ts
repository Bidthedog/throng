import { EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { registerEditorView, unregisterEditorView } from '../../src/renderer/editor/editor-views.js';
import { positionRevealTarget, revealRangeInEditor } from '../../src/renderer/editor/reveal-range.js';

/**
 * #526 follow-up (maintainer, 2026-11-06): a link that names a line opens with that line in the MIDDLE
 * of the editor when the document can scroll that far, not wherever `scrollIntoView: true` leaves it
 * (the nearest edge).
 *
 * Layer: component — the reveal is a dispatch to a real CodeMirror view. jsdom has no layout, so the
 * scroll position itself cannot be read; what is asserted is the scroll the dispatch ASKS for, which is
 * the whole of throng's part in it.
 */

const PANEL = 'p-centre';
let view: EditorView | undefined;

afterEach(() => {
  unregisterEditorView(PANEL);
  view?.destroy();
  view = undefined;
});

describe('revealRangeInEditor — the revealed line is centred', () => {
  it('asks CodeMirror to scroll the target to the vertical centre', async () => {
    const transactions: Transaction[] = [];
    const doc = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [EditorView.updateListener.of((u) => transactions.push(...u.transactions))],
      }),
      parent: document.body,
    });
    registerEditorView(PANEL, view);

    expect(await revealRangeInEditor(PANEL, positionRevealTarget(120), { attempts: 1 })).toBe(true);

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(120);
    const scrolls = transactions.flatMap((t) => t.effects).map((e) => (e.value as { y?: unknown } | null)?.y);
    expect(scrolls).toContain('center');
  });
});
