import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { gutterCompartment } from '../../src/renderer/editor/commands.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

/**
 * The line-number gutter reaches the view through a COMPARTMENT, and a settings change reconfigures
 * it on the live view (040 US4 — FR-041, FR-043; research.md D3).
 *
 * ══ WHAT THIS FILE CLAIMS, AND WHAT IT DELIBERATELY DOES NOT ══
 *
 * It claims two things jsdom can genuinely settle:
 *
 *   1. the gutter's presence is DECIDED BY THE COMPARTMENT'S CONTENT rather than by an
 *      unconditional `lineNumbers()` in the extension list; and
 *   2. a settings change reaches the ALREADY-MOUNTED view — the same `EditorView` instance, not a
 *      remounted one.
 *
 * It does NOT claim the gutter visibly disappears, or that the text column widens. Every rect in
 * jsdom is 0×0, so the rendered EFFECT of a reconfigure is not observable here; that is
 * `packages/ui/tests/e2e/editor-gutter-visibility.e2e.ts`'s job, under `@reserve:layout`.
 *
 * ══ WHY THE VIEW IDENTITY ASSERTION IS THE POINT OF (2) ══
 *
 * "Takes effect without reopening" (FR-043) has an implementation that passes every content check
 * and fails the requirement: recreate the `EditorView` when the setting changes. The gutter would
 * come and go perfectly, and the user's undo history, scroll and selection would go with it —
 * research.md D3 rejects exactly that alternative. So the assertion is not only that the compartment
 * changed but that it changed IN THE SAME VIEW.
 *
 * ══ THE HARNESS HAD TO BE EXTENDED FOR THIS, AND SAYING SO MATTERS ══
 *
 * `mount-editor.ts`'s fake bridge used to answer `config.onChange` with `() => () => {}` — an
 * unsubscribe over a callback it never stored. No settings change could reach a mounted editor, so
 * half of this file could not have been written; `pushSettings` is the emitter that closes it,
 * mirroring the `onSync`/`pushSync` pair beside it. Seeding `opts.settings` alone would have proved
 * only that the MOUNT reads the setting, which is the half a reopen also satisfies.
 */

const DOC = ['one', 'two', 'three', 'four'].join('\n');

/** The compartment's current content, as a list — `[]` when the gutter is off. */
function gutterExtensions(h: EditorHarness): unknown[] {
  const content = gutterCompartment.get(h.view().state);
  expect(content, 'the gutter compartment is not in the state at all').toBeDefined();
  return Array.isArray(content) ? (content as unknown[]) : [content];
}

/**
 * Mount, and wait for BOTH channels this file's assertions depend on (#335's class, #339's run).
 *
 * Waiting only for the document text is what made "puts it back when the setting is turned on
 * again" a flake: `opts.settings` arrives through `config.get()`, which `ConfigProvider` awaits in
 * its own effect, and nothing sequences it against `editor.getContent()`. Every test here that
 * seeds `showGutter: false` then asserts the compartment is EMPTY is asserting on the settings
 * channel — so losing that race reads a tree still holding `DEFAULT_APP_SETTINGS`, where
 * `showGutter` defaults to true and the gutter is therefore still installed.
 *
 * The symptom is the misleading one #335 describes: not a wrong number but a full compartment
 * where an empty one was expected — `expected [ FacetProvider{…}, …(2) ] to deeply equal []`,
 * which reads exactly like a broken reconfigure rather than a test that looked too early. Observed
 * on CI against this branch, then reproduced here 3/3 with `configDelayTicks`.
 */
async function mounted(
  settings?: Record<string, unknown>,
  configDelayTicks = 0,
): Promise<EditorHarness> {
  const h = mountEditor({
    doc: { text: DOC, version: 1, absPath: 'C:/proj/lines.txt' },
    ...(settings ? { settings } : {}),
    configDelayTicks,
  });
  await waitFor(() => expect(h.text()).toContain('one'));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-041 — the gutter is compartment content, not a fixed extension
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gutter arrives through a compartment (FR-041, D3)', () => {
  it('puts something in the gutter compartment when the setting is on', async () => {
    const h = await mounted();
    expect(
      gutterExtensions(h).length,
      'with the gutter on, the compartment must hold the lineNumbers extension',
    ).toBeGreaterThan(0);
  });

  it('leaves the compartment EMPTY when the setting is off at mount', async () => {
    const h = await mounted({ editor: { showGutter: false } });
    expect(
      gutterExtensions(h),
      'with the gutter off, the compartment must hold nothing — an unconditional lineNumbers() ' +
        'elsewhere in the extension list would draw the gutter regardless of this',
    ).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-043 — the change reaches the view that is already open
 * ────────────────────────────────────────────────────────────────────────── */

describe('a settings change reconfigures the LIVE view (FR-043)', () => {
  it('empties the compartment on the same EditorView, with no remount', async () => {
    const h = await mounted();
    const before = h.view();
    expect(gutterExtensions(h).length).toBeGreaterThan(0);

    act(() => {
      h.pushSettings({ editor: { showGutter: false } });
    });

    await waitFor(() => expect(gutterExtensions(h)).toEqual([]));
    expect(
      h.view(),
      'the SAME view — recreating it would satisfy the content check and lose the undo history, ' +
        'the scroll and the selection (D3 rejects exactly that)',
    ).toBe(before);
  });

  it('puts it back when the setting is turned on again', async () => {
    const h = await mounted({ editor: { showGutter: false } });
    const before = h.view();
    expect(gutterExtensions(h)).toEqual([]);

    act(() => {
      h.pushSettings({ editor: { showGutter: true } });
    });

    await waitFor(() => expect(gutterExtensions(h).length).toBeGreaterThan(0));
    expect(h.view()).toBe(before);
  });

  it('reads a seeded setting even when its channel loses the race (#335 class)', async () => {
    /*
     * The regression test for the flake above, and the reason it can be one: `configDelayTicks`
     * pushes `config.get()` far enough behind `editor.getContent()` that the settings ALWAYS
     * arrive second. Against the version of `mounted()` that waited only for the document text
     * this failed 3/3 with the wording CI reported —
     * `expected [ FacetProvider{ …(5) }, …(2) ] to deeply equal []` — because `showGutter` was
     * still its shipped default of true and the gutter had never been removed.
     *
     * Five ticks rather than one, for the reason `editor-update-listener.test.ts` gives: one is
     * enough to lose the race, and four more keep a future hop on either channel from quietly
     * turning this back into a coin toss that passes.
     */
    const h = await mounted({ editor: { showGutter: false } }, 5);
    expect(gutterExtensions(h)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-044 — the selection half, which IS observable without layout
 * ────────────────────────────────────────────────────────────────────────── */

describe('the reconfigure disturbs neither the document nor the selection (FR-044)', () => {
  it('leaves the buffer and the selection exactly where they were', async () => {
    /*
     * FR-044's scroll half needs real layout and lives at E2E — hiding the gutter widens the text
     * column, which re-wraps a wrapped document, so the pixel offset provably moves and only the
     * document anchor can be asserted. The SELECTION half is different: a reconfigure is dispatched
     * in a transaction carrying no `changes` and no `selection`, so `EditorState.selection` carries
     * through by construction. That construction is exactly what this asserts — a reconfigure
     * smuggled in beside a document rewrite would break it here rather than in a window.
     */
    const h = await mounted();
    const view = h.view();
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    const text = view.state.doc.toString();

    act(() => {
      h.pushSettings({ editor: { showGutter: false } });
    });
    await waitFor(() => expect(gutterExtensions(h)).toEqual([]));

    expect(h.view().state.doc.toString(), 'the document').toBe(text);
    expect(h.view().state.selection.main.anchor, 'the anchor').toBe(4);
    expect(h.view().state.selection.main.head, 'the head').toBe(7);
  });
});
