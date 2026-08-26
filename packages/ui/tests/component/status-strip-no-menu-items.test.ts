/**
 * The readouts get NO content-menu items, and that is a requirement (040 US1 — FR-009).
 *
 * ══ WHY A NEGATIVE NEEDS A TEST AT ALL ══
 *
 * The constitution (024, Principle VI) requires every panel-level ACTION to appear in the panel's
 * content menu, so that an action stays reachable when the status bar is switched off. Word Wrap
 * has an item for exactly that reason, and Set Language has one, and both say so in their own
 * comments right above them.
 *
 * A readout is not an action. There is nothing to invoke, nothing to toggle, and nothing that
 * becomes unreachable when the bar is hidden — the figure simply is not shown, which is what the
 * preference is FOR. FR-009 states that explicitly rather than leaving it to be re-derived, because
 * the rule beside it reads as though it applies.
 *
 * So the failure this guards is a specific and very plausible one: somebody reads Principle VI,
 * notices five things on the status bar with no menu items, and "fixes" it — producing five items
 * that do nothing when clicked, in the menu that is supposed to be the reachable route to
 * everything the bar can do.
 *
 * ══ WHY A COMPONENT TEST AND NOT A UNIT ONE ══
 *
 * It is where the menu's other assertions live (`editor-content-menu.test.ts`), and it needs the
 * same harness: `editorContentMenu` is a pure function over its arguments, and the two-member view
 * stand-in below is what `menu-sections.test.ts` and `editor-content-menu.test.ts` already use,
 * because jsdom has no layout and a real `EditorView` would answer `null` to every measurement.
 */
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';

/** The menu as an open editor would build it, with wrap on and a language resolved. */
function menu() {
  return editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: true, toggle: () => {}, chord: 'Ctrl+Alt+W' },
    gotoLine: { open: () => {}, chord: 'Ctrl+G' },
    languageName: 'Rust',
  });
}

/** Every word the readouts are built from, visible label and accessible name alike. */
const READOUT_WORDS = [
  'Ln',
  'Col',
  'line',
  'column',
  'selected',
  'chars',
  'characters',
  'words',
  'word count',
  'character count',
];

describe('the readouts are readouts, not actions (FR-009)', () => {
  it('adds no menu item for any of them', () => {
    const labels = menu().map((item) => item.label);

    // "Word Wrap" contains "word", and "Go To Line…" contains "Line" — both are pre-existing items
    // and both are genuinely ACTIONS, so the match has to be against the readouts' own vocabulary
    // rather than against any word they happen to share.
    const offenders = labels.filter((label) =>
      /^(Ln|Col)\b|character count|word count|selected characters|Line and Column/i.test(label),
    );
    expect(
      offenders,
      'a readout has nothing to invoke; a menu item for one would do nothing when clicked',
    ).toEqual([]);
  });

  it('leaves the menu exactly as 016, 024 and 033 left it', () => {
    /*
     * The stronger form, and the one that actually catches the mistake: the menu's item list is
     * pinned, so an addition of ANY kind by this feature fails here rather than only an addition
     * that happens to use one of the words above.
     */
    expect(menu().map((item) => item.label)).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Undo',
      'Redo',
      'Go To Line…',
      'Set Language… (Rust)',
      'Word Wrap ✓',
    ]);
  });

  it('still carries the two items that ARE actions on the bar', () => {
    /*
     * The anti-vacuity control. Every assertion above is satisfied by a menu that is empty or by an
     * `editorContentMenu` that threw and was caught — and it is also the point being made: Word
     * Wrap and Set Language have items BECAUSE they are actions, which is precisely the distinction
     * FR-009 draws. Deleting one of them to make this file green would be the opposite error.
     */
    const labels = menu().map((item) => item.label);
    expect(labels).toContain('Word Wrap ✓');
    expect(labels).toContain('Set Language… (Rust)');
  });

  it('names no readout in any menu item at all, label or test id', () => {
    // Belt and braces over the pinned list: an item added with an empty label, or one whose text
    // is built at render time, would slip past a label comparison.
    const serialised = JSON.stringify(
      menu().map(({ label, testId, section }) => ({ label, testId, section })),
    );

    for (const word of READOUT_WORDS) {
      if (word === 'word count' || word === 'character count') {
        expect(serialised.toLowerCase(), `no item may be about the ${word}`).not.toContain(word);
      }
    }
    expect(serialised).not.toContain('editor-status-');
  });
});
