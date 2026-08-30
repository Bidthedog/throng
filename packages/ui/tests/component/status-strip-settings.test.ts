/**
 * What the three status-bar preferences actually do to the bar (040 US3 — FR-030, FR-031, FR-033).
 *
 * ══ WHY `EditorPanel` AND NOT `StatusStrip` ══
 *
 * `editor.showStatusBar` is read by `editor-panel.tsx`, not by `status-strip.tsx` — the strip reads
 * only `editor.defaultWordWrap`. A test that rendered the strip directly could never see the bar
 * hidden, because the component that hides it would not be in the tree. So the whole-bar assertions
 * mount the real panel, through `helpers/mount-editor.ts`, with the settings the bridge would have
 * delivered.
 *
 * ══ THE REVEAL PATH THIS TEST MUST NOT TRIP ══
 *
 * The panel's gate is `{(showStatusBar || revealedForPicker) && …}`. The bar is deliberately shown
 * when the language picker is opened from the content menu EVEN WITH THE SETTING OFF — otherwise
 * "Set Language…" would have nowhere to open. Nothing below asks for the picker, so "hidden
 * regardless" here means "hidden with the preference off and nothing asking to reveal it", which is
 * exactly what FR-033 claims. Asserting it any more strongly would be asserting against a shipped
 * requirement rather than for one.
 *
 * ══ THE LANGUAGE LABEL IS CHECKED IN THE RIGHT GROUP, AND THAT IS NOT PEDANTRY ══
 *
 * With both readout toggles off the LEFT group is empty. `justify-content: space-between` with a
 * single child puts that child on the LEFT — so a bar that dropped its empty readouts container
 * would move the language label to the wrong edge and silently break 016 FR-010c's right-aligned
 * label. jsdom cannot measure that, but it can see which group the label is in, and group
 * membership is what the CSS acts on.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every "absent" assertion below sits beside a "present" one in the SAME test — line and column
 * gone while the counts stay, the counts gone while line and column stay — so a panel that rendered
 * no bar at all fails rather than passes. The one test with no positive counterpart, the whole-bar
 * one, waits for the bar to be PRESENT on the shipped defaults first.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountEditor } from './helpers/mount-editor.js';
import { __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  __resetDocumentMetricsStore,
  documentMetrics,
} from '../../src/renderer/editor/document-metrics-store.js';
import {
  __resetWordWrapStore,
  documentWordWrap,
  wordWrapDocKey,
} from '../../src/renderer/editor/word-wrap-store.js';

const PANEL = 'p-ed';
const FILE = 'C:/proj/notes.txt';
/** 11 characters over 2 words — small enough to state, large enough to be a real count. */
const TEXT = 'hello world';

const strip = (): HTMLElement | null => screen.queryByTestId(`editor-status-strip-${PANEL}`);
const readout = (id: string): HTMLElement | null =>
  screen.queryByTestId(`editor-status-${id}-${PANEL}`);

/**
 * Mount the panel with `editor` settings merged over the shipped defaults.
 *
 * The bridge answers `config.get` with this document and the store parses it exactly as it parses a
 * real `settings.json` — so an unspecified key falls back the way it would on a user's machine
 * rather than being absent.
 *
 * `configDelayTicks` holds that answer back, so the settings channel provably loses its race with
 * the document channel — see {@link settled}.
 */
function panelWith(
  editor: Record<string, unknown>,
  configDelayTicks = 0,
): ReturnType<typeof mountEditor> {
  return mountEditor({
    panelId: PANEL,
    doc: { text: TEXT, version: 1, absPath: FILE },
    settings: { editor },
    configDelayTicks,
  });
}

/**
 * Wait until the tree is holding the SEEDED settings rather than the shipped defaults (issue #345).
 *
 * ══ WHICH MOUNTS NEED THIS, AND WHICH ALREADY HAD IT ══
 *
 * `config.get()` and `editor.getContent()` are two promises, and nothing orders them. A test that
 * waits only for something the DOCUMENT produces has said nothing about whether the settings have
 * landed — so it asserts against `DEFAULT_APP_SETTINGS` whenever the settings channel loses. That
 * is #335 in `editor-update-listener.test.ts` and again in `gutter-compartment.test.ts`, and this
 * file was the third instance of the same shape.
 *
 * The distinction that matters here, because it is what makes only SOME tests below exposed:
 *
 * - The two tests that wait on `chars` or `line` are waiting on a readout the shipped defaults draw
 *   TOO. The wait passes whether or not the seed arrived, so it is not a settings wait at all —
 *   their only guard was the unrelated 200 ms metrics debounce happening to outlast the race.
 *   Measured on this file at `configDelayTicks: 20`: both fail, `line is off: expected <span> to be
 *   null` and `chars is a count: expected <span> to be null`, reading the defaults exactly as #345
 *   predicted.
 * - The three tests that wait for the bar or a readout to be ABSENT are waiting on the observable
 *   the SEEDED setting produces, which cannot pass until the seed has landed. Those are correct as
 *   written and are deliberately left alone; the helper's own doc calls that the better form.
 */
async function settled(h: ReturnType<typeof mountEditor>): Promise<void> {
  await waitFor(() => expect(h.settingsLoaded(), 'the seeded settings have landed').toBe(true));
}

beforeEach(() => {
  __resetCaretStore();
  __resetDocumentMetricsStore();
  __resetWordWrapStore();
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-030 — the cursor position, on its own
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.statusBar.showCursorPosition governs line and column, and nothing else (FR-030)', () => {
  it('removes line and column and leaves the counts', async () => {
    const h = panelWith({ statusBar: { showCursorPosition: false } });
    await settled(h);

    // The counts arrive through the real 200 ms-debounced store, so they are waited for rather than
    // poked in — a bar reading the wrong document key fails here.
    await waitFor(() => expect(readout('chars')).not.toBeNull());
    expect(readout('words')).not.toBeNull();
    expect(readout('line'), 'line is off').toBeNull();
    expect(readout('column'), 'column is off').toBeNull();
  });

  it('reads the preference even when the settings channel provably loses (#345)', async () => {
    /*
     * The regression test for the wait above, and the reason it is a separate `it` rather than a
     * delay added to the one before it: the delay has to be big enough to outlast the 200 ms metrics
     * debounce, which is what accidentally covered this file for as long as it did. At
     * `configDelayTicks: 20` the same assertions fail without `settled()` — measured — and pass with
     * it. Left as the ordinary path, the delay would just make every run of this file slower for a
     * guarantee one test can hold.
     */
    const h = panelWith({ statusBar: { showCursorPosition: false } }, 20);
    await settled(h);

    await waitFor(() => expect(readout('chars')).not.toBeNull());
    expect(readout('words')).not.toBeNull();
    expect(readout('line'), 'line is off').toBeNull();
    expect(readout('column'), 'column is off').toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-031 — all three counts, as one
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.statusBar.showCounts governs all three counts together (FR-031)', () => {
  it('removes selected, chars and words and leaves line and column', async () => {
    const h = panelWith({ statusBar: { showCounts: false } });
    await settled(h);
    await waitFor(() => expect(readout('line')).not.toBeNull());

    // A real selection, so the `selected` readout would be present if the toggle did not govern it.
    h.view().dispatch({ selection: { anchor: 0, head: 5 } });

    /*
     * WAIT FOR THE COUNTS TO EXIST BEFORE ASSERTING THEY ARE NOT DRAWN.
     *
     * The counts arrive 200 ms after the last edit (FR-008b), so `waitFor(() => expect(chars).
     * toBeNull())` succeeds on its FIRST poll whatever the toggle does — the debounce has not
     * fired yet. That is a green bar proving nothing, and it is the exact shape of a test that goes
     * quiet on a fast machine. Waiting on the STORE instead makes the absence a statement about the
     * bar: the figures are known, and the bar is choosing not to draw them.
     */
    await waitFor(() => expect(documentMetrics(wordWrapDocKey(FILE, PANEL))).not.toBeNull());

    expect(readout('chars'), 'chars is a count').toBeNull();
    expect(readout('words'), 'words is a count').toBeNull();
    expect(readout('selected'), 'so is the selected figure').toBeNull();
    expect(readout('line'), 'the position stays').not.toBeNull();
    expect(readout('column')).not.toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-013 — both off still leaves the controls, and leaves them on the RIGHT
 * ────────────────────────────────────────────────────────────────────────── */

describe('with both toggles off the bar keeps its controls (FR-013)', () => {
  it('renders the language control and the wrap toggle, in the trailing group', async () => {
    panelWith({ statusBar: { showCursorPosition: false, showCounts: false } });
    await waitFor(() => expect(readout('line')).toBeNull());

    const controls = screen.getByTestId(`editor-status-controls-${PANEL}`);
    expect(controls).toContainElement(screen.getByTestId(`editor-language-${PANEL}`));
    expect(controls).toContainElement(screen.getByTestId(`editor-word-wrap-${PANEL}`));

    // The empty left group still renders. Without it `space-between` has one child and puts it on
    // the LEFT — 016 FR-010c's right-aligned label, broken by an invisible change.
    const readouts = screen.getByTestId(`editor-status-readouts-${PANEL}`);
    expect(readouts).toBeInTheDocument();
    expect(readouts).not.toContainElement(screen.getByTestId(`editor-language-${PANEL}`));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-033 — showStatusBar hides the whole bar, and disables no command
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.showStatusBar overrides both readout toggles (FR-033)', () => {
  it('hides the whole bar even with both readout toggles on', async () => {
    // Both readout toggles explicitly ON, so the only thing that can remove the bar is the outer
    // preference — and the bar is confirmed present first, on the shipped defaults.
    mountEditor({
      panelId: PANEL,
      doc: { text: TEXT, version: 1, absPath: FILE },
    });
    await waitFor(() => expect(strip()).not.toBeNull());
    // Torn down explicitly: the file's automatic cleanup runs BETWEEN tests, and the second mount
    // below would otherwise render a second bar into the same document — where `queryByTestId`
    // throws on the duplicate rather than answering the question this test asks.
    cleanup();

    panelWith({
      showStatusBar: false,
      statusBar: { showCursorPosition: true, showCounts: true },
    });
    await waitFor(() => expect(strip(), 'the whole bar is gone').toBeNull());
    expect(readout('line')).toBeNull();
    expect(readout('chars')).toBeNull();
    expect(screen.queryByTestId(`editor-language-${PANEL}`)).toBeNull();
  });

  it('does not disable the wrap command or its Ctrl+Alt+W chord (FR-033, 024)', async () => {
    /*
     * The second half of FR-033, and the half a "hide the row" implementation gets wrong. The chord
     * lives in the editor's own keymap, not on the bar, so hiding the bar must not take it away —
     * a user who turned the bar off to reclaim a row did not ask to lose word wrap.
     *
     * This is ALSO asserted end to end (`status-bar-visibility.e2e.ts:90`, `@extended @window`,
     * from #152), and that spec stays: the E2E budget ratchets downward too, so removing it would
     * need its own re-seed and would trade a real-window check for a cheaper one.
     */
    const h = panelWith({ showStatusBar: false, defaultWordWrap: true });
    await waitFor(() => expect(strip()).toBeNull());

    const docKey = wordWrapDocKey(FILE, PANEL);
    expect(documentWordWrap(docKey, true), 'seeded from the preference').toBe(true);

    fireEvent.keyDown(h.content(), { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true });

    await waitFor(() => expect(documentWordWrap(docKey, true)).toBe(false));
    // …and still no bar. The chord toggled the document, not the preference.
    expect(strip()).toBeNull();
  });
});
