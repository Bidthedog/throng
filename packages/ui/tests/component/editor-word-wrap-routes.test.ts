/**
 * Word wrap toggles from the status bar and from the editor content menu (#152, 024 US1).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-feedback.e2e.ts` ("word wrap toggles from the status bar,
 * the chord, and the content menu"). The chord is `component/editor-two-stroke-chord.test.ts`; the
 * status bar's live-chord title is `component/status-strip-wrap-title.test.ts`. What nothing below E2E
 * did was CLICK either route and read the result: the button's state and the live view's
 * `cm-lineWrapping` class (jsdom has no layout, so the class — which is what CodeMirror's wrap
 * extension sets — stands in for the computed `white-space`), and the content menu's checkable
 * "Word Wrap" item.
 *
 * Layer: component — the toggle is wiring between a menu item, a store and a CodeMirror compartment,
 * all of which mount in jsdom; only the painted reflow needs a real layout, and the class is its cause.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

const PANEL = 'p-wrap-routes';
let seq = 0;
let h: EditorHarness | undefined;

afterEach(() => {
  h?.unmount();
  h = undefined;
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

async function mount(): Promise<EditorHarness> {
  const harness = mountEditor({
    panelId: PANEL,
    // A unique path per test: the wrap state is per DOCUMENT and outlives a mount.
    doc: { text: `${'x'.repeat(400)}\n`, version: 1, absPath: `C:/proj/wrap-routes-${++seq}.txt` },
    settings: { defaultWordWrap: true },
  });
  h = harness;
  await waitFor(() => expect(harness.settingsLoaded()).toBe(true));
  await waitFor(() => expect(harness.text()).toContain('xxxx'));
  return harness;
}

const wrapped = (e: EditorHarness): boolean => e.view().contentDOM.classList.contains('cm-lineWrapping');
const button = (): HTMLElement => screen.getByTestId(`editor-word-wrap-${PANEL}`);

describe('word wrap toggles from its two click routes (#152)', () => {
  it('the status-bar button flips the view, its label and aria-pressed, both ways', async () => {
    const ed = await mount();
    await waitFor(() => expect(wrapped(ed)).toBe(true));
    expect(button()).toHaveTextContent('Wrap');
    expect(button()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button());
    await waitFor(() => expect(wrapped(ed)).toBe(false));
    expect(button()).toHaveTextContent('No Wrap');
    expect(button()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button());
    await waitFor(() => expect(wrapped(ed)).toBe(true));
    expect(button()).toHaveTextContent('Wrap');
  });

  it('the content menu carries a checkable Word Wrap item that mirrors the state and toggles it', async () => {
    const ed = await mount();
    await waitFor(() => expect(wrapped(ed)).toBe(true));

    fireEvent.contextMenu(ed.content());
    expect(await screen.findByTestId('menu-item-Word Wrap')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('menu-item-Word Wrap'));

    await waitFor(() => expect(wrapped(ed)).toBe(false));
    // The status bar reads the SAME state: one document, one wrap setting (Principle XI).
    expect(button()).toHaveTextContent('No Wrap');

    fireEvent.contextMenu(ed.content());
    expect(await screen.findByTestId('menu-item-Word Wrap')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('menu-item-Word Wrap'));
    await waitFor(() => expect(wrapped(ed)).toBe(true));
  });
});
