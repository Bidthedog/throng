import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

/**
 * The SECOND file opened into a panel indents like ITSELF (016 FR-018a).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-file-switch.e2e.ts` (035 T056) — two declarations:
 *
 *   `:227` the FILE's indentation wins when it is the SECOND file opened into the panel
 *   `:253` …and the reverse: a space-indented file opened after a tab-indented one
 *
 * ══ THE DECISION WAS PROVEN; THE RE-DECIDING WAS NOT ══
 *
 * `inferIndent` and `effectiveIndent` are pure and covered together in
 * `integration/indent-infer.integration.test.ts:108` — tabs beating the setting, four spaces beating
 * the global default, the language fallback, the global fallback. Every one of those asks the
 * question once, for one file.
 *
 * What these two tests were about is the SECOND answer: that opening another file into a panel that
 * already holds one re-reads the incoming file rather than keeping the profile it worked out for the
 * outgoing one. That is `reinferIndent`, called from exactly two places in `use-editor.ts` — the
 * initial adopt (`:1153`) and a document REPLACEMENT (`:1036`) — and nothing below E2E had ever
 * exercised the second. This spec's recurring finding, again: both halves proven, the seam between
 * them not.
 *
 * ══ AND THE EDITOR MOUNTS IN JSDOM, WHICH NOBODY HAD TRIED ══
 *
 * See `helpers/mount-editor.ts`. A real `EditorView` renders `.cm-content` and handles keydown
 * through its own keymap; what jsdom cannot do is LAYOUT. So the pressing of Tab, the command it
 * reaches, the profile that command reads and the text that lands in the document are all here —
 * and the file's rendered appearance is not, which is why `editor-file-switch.e2e.ts` keeps its
 * markdown-highlighting test under `@reserve:layout`.
 *
 * The second open goes through `getEditorActions(panelId).openFile`, which is the route a tree click
 * takes: it calls `editor.load`, records the new path, and re-derives the language from it before
 * the replacement content arrives. Pushing a bare reset would skip all of that — including the
 * ordering `use-editor.ts:600` calls out as load-bearing — and would prove nothing about an open.
 */

/** Two spaces, the style TypeScript's shipped profile and the global default both agree on. */
const SPACED_TS = ['export const value = {', '  a: 1,', '  b: 2,', '};', ''].join('\n');
/** Tabs — which neither the TypeScript profile nor the global default would choose. */
const TABBED_TS = ['function a() {', '\treturn 1;', '}', ''].join('\n');
/** Two spaces in a language whose own profile is TABS, so only the file can produce spaces. */
const SPACED_GO = ['package main', '', 'func main() {', '  println("x")', '}', ''].join('\n');

const CARET_AT_START = { anchor: 0 };

/** Put the caret at the top of the document and press Tab, as the migrated tests did. */
function pressTabAtStart(h: EditorHarness): void {
  const view = h.view();
  view.dispatch({ selection: CARET_AT_START });
  fireEvent.keyDown(h.content(), { key: 'Tab', code: 'Tab' });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the file’s own indentation wins on a SECOND open (FR-018a, migrated from editor-file-switch.e2e.ts)', () => {
  it('indents with a TAB after a tab-indented file replaces a space-indented one', async () => {
    /*
     * The migrated `:227`, and the ordering is the whole test: the SPACE file goes first so that
     * anything stale is "spaces". TypeScript's profile is spaces and so is the global default, so a
     * tab here can only have come from the incoming file's own lines.
     */
    const h = mountEditor({
      doc: { text: SPACED_TS, version: 1, absPath: 'C:/proj/a-first.ts' },
    });
    await waitFor(() => expect(h.text()).toContain('export const value'));

    await h.openFile({ text: TABBED_TS, version: 2, absPath: 'C:/proj/d-tabs.ts' });
    await waitFor(() => expect(h.text()).toContain('function a()'));

    pressTabAtStart(h);

    const text = h.view().state.doc.toString();
    expect(text.startsWith('\t'), 'a tab, from the file that is open NOW').toBe(true);
    expect(text.startsWith('  ')).toBe(false);
  });

  it('indents with SPACES after a space-indented file replaces a tab-indented one', async () => {
    /*
     * The migrated `:253`, the mirror. Go's language profile is TABS, so only the incoming file's
     * own two-space style can produce spaces — and a panel that kept the outgoing file's tab profile
     * would agree with the language and pass unnoticed.
     */
    const h = mountEditor({
      doc: { text: TABBED_TS, version: 1, absPath: 'C:/proj/d-tabs.ts' },
    });
    await waitFor(() => expect(h.text()).toContain('function a()'));

    await h.openFile({ text: SPACED_GO, version: 2, absPath: 'C:/proj/e-spaces.go' });
    await waitFor(() => expect(h.text()).toContain('package main'));

    pressTabAtStart(h);

    const text = h.view().state.doc.toString();
    expect(text.startsWith('\t')).toBe(false);
    expect(text.startsWith(' '), 'spaces, from the file that is open NOW').toBe(true);
  });

  it('reads the FIRST file too, so the pair above is about re-reading rather than reading', async () => {
    // Without this, a panel that inferred nothing at all and always fell through to the language
    // would still pass one of the two above — and would look like a working feature.
    const h = mountEditor({
      doc: { text: TABBED_TS, version: 1, absPath: 'C:/proj/d-tabs.ts' },
    });
    await waitFor(() => expect(h.text()).toContain('function a()'));

    pressTabAtStart(h);

    expect(h.view().state.doc.toString().startsWith('\t')).toBe(true);
  });

  it('shows the FIRST file byte for byte, without reindenting it (FR-018d)', async () => {
    /*
     * MIGRATED FROM `editor-indentation.e2e.ts:195`, the rendered half. The coordinator's half —
     * the file untouched on disk and the document clean — is
     * `integration/indent-infer.integration.test.ts:70` and `:82`, which asserts `version === 0`
     * rather than merely an absent dot: not one edit was applied.
     */
    const h = mountEditor({
      doc: { text: TABBED_TS, version: 1, absPath: 'C:/proj/tabs.ts' },
    });

    await waitFor(() => expect(h.view().state.doc.toString()).toBe(TABBED_TS));
  });

  it('does not rewrite the incoming file’s existing lines on a REPLACEMENT (FR-018d)', async () => {
    /*
     * Reading a file's style is not an edit to it. The integration file proves this for a load
     * (`:70`); this proves it for the REPLACEMENT, which is a different code path and the one that
     * would be tempting to implement by normalising the incoming text.
     */
    const h = mountEditor({
      doc: { text: SPACED_TS, version: 1, absPath: 'C:/proj/a-first.ts' },
    });
    await waitFor(() => expect(h.text()).toContain('export const value'));

    await h.openFile({ text: TABBED_TS, version: 2, absPath: 'C:/proj/d-tabs.ts' });

    await waitFor(() => expect(h.view().state.doc.toString()).toBe(TABBED_TS));
  });
});
