/**
 * The language picker is a LISTBOX, not a hundred tab stops (024 follow-up).
 *
 * PLACE AT: `packages/ui/tests/component/language-picker-keyboard.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/language-picker-keyboard.e2e.ts` —
 * `Tab moves between the filter and the list; arrows move within it; Enter confirms` (034 FR-045).
 * That was the file's only test, so the E2E spec goes with it.
 *
 * ══ WHY THIS ONE COMES DOWN ══
 *
 * It launched Electron, started a daemon, made a real temp project, wrote `thing.txt` to disk,
 * created a panel, turned it into an editor, opened the file through the real file-explorer tree and
 * waited for CodeMirror to paint the word `hello` — in order to press Tab and read
 * `document.activeElement`. Nothing it asserted came from any of that: no text was edited, the
 * document was never saved, and the only thing the file contributed was a language for the strip to
 * name. Every mechanism under test is DOM, in one component tree:
 *
 *   1. `language-picker.tsx:196` — the roving tabindex. Only the ACTIVE option carries `tabIndex 0`;
 *      every other option is `-1`, which is what makes the list one tab stop instead of a hundred.
 *   2. `language-picker.tsx:118` — `onListKeyDown`: ArrowDown/ArrowUp move the active option, and
 *      ArrowUp AT THE TOP hands the keyboard back to the filter.
 *   3. `language-picker.tsx:167` — the filter's own ArrowDown, the way IN to the list.
 *   4. `focus-trap.ts:126` — the strip's Tab handler, which is what keeps Tab from walking out of an
 *      open picker into the rest of the application.
 *   5. `language-picker.tsx:203` — the option is a `<button>`, so Enter on it is a click, which is
 *      `choose()`; `status-strip.tsx:141` then re-renders the label from the language store.
 *
 * ══ VERIFIED NOT ALREADY COVERED (034 FR-046a) ══
 *
 * Three neighbours look like they might cover this. All three were read, and none does:
 *
 *   - `packages/ui/tests/component/status-strip-picker-dismissal.test.ts` — four tests, and every
 *     one of them is about a MOUSE gesture (`await user.click(...)`) plus Escape. It never presses
 *     Tab or an arrow key, and it never chooses a language: its bridge REJECTS every RPC precisely
 *     because "no test here chooses one" (its line 74 comment). Confirming a choice is the one thing
 *     it is built to prove cannot happen.
 *   - `packages/ui/tests/component/picker.test.ts:1` — a different component
 *     (`common/picker.tsx`, Quick Open / the tab typeahead) with a different keyboard model: it has
 *     no roving tabindex, no listbox role and no filter-to-list handoff. Its own header says so.
 *   - `packages/ui/tests/component/menu-keyboard.test.ts` — the context MENU's arrow keys
 *     (`workspace/context-menu.tsx`), which is neither this component nor this mechanism.
 *
 * `packages/ui/tests/component/confirm-modality.test.ts` does cover `useFocusTrap` — but over the
 * CONFIRM dialog, whose focusable set is two plain buttons. The bug this file's item 4 is about only
 * exists where a roving tabindex is present: `focus-trap.ts:61-66` carries a `el.tabIndex >= 0`
 * filter written FOR this picker, and its comment names it. That filter is unexercised by the
 * confirm dialog, where no element has a negative tabindex.
 *
 * ══ WHERE THIS LANDS STRONGER THAN THE E2E DID ══
 *
 *   - The E2E asserted Tab stayed inside `editor-status-strip-<pid>` for eight presses. In a real
 *     app there is a whole window to leak into, but the assertion could not say WHERE it went, only
 *     that it had not. Here the strip is flanked by two focusable controls placed deliberately
 *     BEFORE and AFTER it, and the cycle is asserted as a SEQUENCE — so a trap that pinned focus to
 *     one control satisfies "still inside" eight times over and fails on the first entry.
 *   - The E2E proved Enter closed the picker and the strip read `JSON`. It never checked that the
 *     choice was PERSISTED. `document.setState` is asserted here, with its arguments, so a picker
 *     that re-highlighted the view and quietly forgot the decision reddens.
 *   - `ArrowUp` off the top of the list is asserted to land on the filter AND to be reversible in
 *     the same test, which is the "a door that only opens one way is not a door" claim
 *     `language-picker.tsx:124` is written around.
 *
 * ══ THE `offsetParent` STUB, AND WHY IT IS LOAD-BEARING ══
 *
 * Identical to `confirm-modality.test.ts:75` and taken from it. `focus-trap.ts:67` filters its
 * focusable set on `el.offsetParent !== null`, and **jsdom's `offsetParent` returns `null`
 * unconditionally** — so without the stub the set collapses to whichever single element is
 * `document.activeElement`, every Tab reads as "at the end", and focus is pinned. The weak form of
 * every assertion here would still pass. jsdom has no layout, so this is not a simplification of a
 * real behaviour; it is the answer a browser gives for a document that hides nothing.
 *
 * ══ THE REGISTERED EDITOR VIEW ══
 *
 * `setDocumentOverride` (`language-override.ts:57`) only calls `setPanelLanguage` when
 * `getEditorView(panelId)` returns a view — so with no view registered, the strip's label would
 * never change and the last test would be asserting nothing. A stub view with a no-op `dispatch` is
 * registered instead of mounting CodeMirror. That is honest rather than convenient: the view is the
 * SEAM the picker reconfigures, and what a grammar swap does to a real CodeMirror document is
 * `editor-fidelity.integration.test.ts`'s claim, not this file's.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 * Nothing from this spec — it had one test and its every assertion moves. What is NOT claimed here,
 * and was not claimed there either: that the picker is positioned above the strip and clamped to the
 * window (`language-picker.tsx:68` measures a real `getBoundingClientRect`, which jsdom answers with
 * zeroes — Principle V's real-layout reserve, and FR-049), and that a language chosen here survives
 * a restart (`editor-language-override.e2e.ts`, which stays).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, hand the `ServicesProvider` an undefined services object instead of the fake
 * one — the provider stays, and provides nothing.
 * `LanguagePicker` calls `useServices()` on its first render, which throws
 * `useServices must be used within a ServicesProvider` (`composition-root.tsx:52`), and every test
 * here opens the picker as its FIRST action inside `openPicker()`, which then awaits it being on
 * screen. **ALL SEVEN tests fail** — on a render, not on a module that would not load, which is the
 * distinction that made an earlier control on this branch report "no tests" and prove nothing.
 *
 * No test here can be satisfied by an empty document either: each one asserts a live
 * `document.activeElement` inside a rendered picker, or the picker's PRESENCE, before it asserts any
 * absence. The one `toBeNull()` in the file (the picker after Enter) is preceded by
 * `openPicker()`'s wait for that same element.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveLanguage } from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { removePanelLanguage, setPanelLanguage } from '../../src/renderer/editor/editor-language.js';
import {
  registerEditorView,
  unregisterEditorView,
} from '../../src/renderer/editor/editor-views.js';
import { __resetTransientOverlayForTests } from '../../src/renderer/common/transient-overlay.js';

const PANEL = 'panel-1';
const PROJECT = 'proj-1';
/** The E2E's own fixture file: a `.txt`, so the strip opens on Plain Text and JSON is a real change. */
const REL_PATH = 'thing.txt';

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed visibility test — see the header note. Restored exactly.
 * ────────────────────────────────────────────────────────────────────────── */

let realOffsetParent: PropertyDescriptor | undefined;

beforeAll(() => {
  realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    // "Rendered, and not inside a display:none subtree" — true of every attached element in a jsdom
    // document that hides nothing. `null` for a detached one, exactly as a browser.
    get(this: HTMLElement): Element | null {
      return this.parentElement;
    },
  });
});

afterAll(() => {
  // jsdom's own getter goes back rather than the property being deleted: a neighbouring file that
  // reads `offsetParent` later must see jsdom's answer, not this file's opinion of it.
  if (realOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Services
 * ────────────────────────────────────────────────────────────────────────── */

interface Recorded {
  method: string;
  params: unknown;
}

/**
 * A bridge that records every RPC and answers `document.setState`.
 *
 * Unlike `status-strip-picker-dismissal.test.ts`'s rejecting stub, this file DOES choose a language,
 * and the persistence of that choice is one of the things being asserted. Anything else the strip
 * might reach for is still rejected, so a component that started talking to the daemon on OPEN would
 * be named rather than absorbed.
 */
function fakeServices(calls: Recorded[]): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      calls.push({ method, params });
      if (method === 'document.setState') {
        const p = params as { relPath: string; languageId: string | null };
        return Promise.resolve({
          state: { relPath: p.relPath, languageId: p.languageId },
        } as unknown as TResult);
      }
      return Promise.reject(new Error(`unexpected RPC from the status strip: ${method}`));
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

afterEach(() => {
  removePanelLanguage(PANEL);
  unregisterEditorView(PANEL);
  // The picker claims the window's one transient-overlay slot; a test that failed mid-way would
  // otherwise leave it claimed for the next one.
  __resetTransientOverlayForTests();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The mount
 * ────────────────────────────────────────────────────────────────────────── */

function mount(): { user: ReturnType<typeof userEvent.setup>; calls: Recorded[] } {
  // The strip names whatever the language store says this panel resolved to, seeded through the REAL
  // resolver so the starting label is the one production would draw for `thing.txt`.
  setPanelLanguage(PANEL, resolveLanguage({ fileName: REL_PATH }));
  // See the header: without a registered view, `setDocumentOverride` never calls `setPanelLanguage`
  // and the label could not change. `dispatch` is a no-op — what a grammar swap does to a real
  // document is another layer's claim.
  registerEditorView(PANEL, { dispatch: () => {} } as unknown as EditorView);

  const calls: Recorded[] = [];
  const user = userEvent.setup();
  render(
    // ANTI-VACUITY CONTROL: drop this `ServicesProvider` element and `useServices` throws inside
    // `LanguagePicker`, failing all seven tests. See the file header.
    createElement(
      ServicesProvider,
      { services: fakeServices(calls) },
      createElement(
        'div',
        null,
        // The application on either side of the strip. These are the point of the fixture: a focus
        // trap tested against an empty document proves nothing, because there is nowhere to leak to.
        // One BEFORE and one AFTER, so a leak in either direction has somewhere to land.
        createElement('button', { key: 'before', type: 'button', 'data-testid': 'outside-before' }, 'Before'),
        createElement(StatusStrip, {
          key: 'strip',
          panelId: PANEL,
          projectId: PROJECT,
          relPath: REL_PATH,
        }),
        createElement('input', { key: 'after', 'data-testid': 'outside-after' }),
      ),
    ),
  );
  return { user, calls };
}

const languageButton = (): HTMLElement => screen.getByTestId(`editor-language-${PANEL}`);
const filter = (): HTMLElement => screen.getByTestId(`language-filter-${PANEL}`);
const picker = (): HTMLElement | null => screen.queryByTestId(`language-picker-${PANEL}`);

/** What holds the keyboard, by test id — named rather than boolean, so a stuck trap is visible. */
const focused = (): string =>
  document.activeElement?.getAttribute('data-testid') ??
  document.activeElement?.tagName.toLowerCase() ??
  'nothing';

const insideStrip = (): boolean =>
  document.activeElement?.closest(`[data-testid="editor-status-strip-${PANEL}"]`) != null;

/** Open the picker from the strip's own language button, and settle on it being on screen. */
async function openPicker(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(languageButton());
  // Waiting for the picker rather than assuming it: this is what the anti-vacuity control trips,
  // and it guards every test in the file.
  await waitFor(() => expect(picker()).not.toBeNull());
}

/**
 * Narrow the list to the two JSON languages, exactly as the E2E did.
 *
 * `json` and `jsonc` (`packages/core/src/editor/languages.ts:104-105`) are the only two entries
 * whose name or id contains "json", so the list below is a KNOWN pair — which is what lets the arrow
 * assertions name rows instead of counting them.
 */
async function filterToJson(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(filter());
  await user.type(filter(), 'json');
  await waitFor(() => expect(screen.getByTestId('language-option-json')).toBeVisible());
  expect(
    screen.getAllByTestId(/^language-option-/).map((el) => el.getAttribute('data-testid')),
    'the filter is meant to leave exactly the two JSON languages',
  ).toEqual(['language-option-json', 'language-option-jsonc']);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The tests
 * ────────────────────────────────────────────────────────────────────────── */

describe('opening it', () => {
  it('hands the keyboard to the filter, so the user can type straight away', async () => {
    const { user } = mount();
    await openPicker(user);

    await waitFor(() => expect(focused()).toBe(`language-filter-${PANEL}`));
  });
});

describe('the list is ONE tab stop, not a hundred', () => {
  it('one Tab from the filter lands on the first option — it does not step through languages', async () => {
    const { user } = mount();
    await openPicker(user);
    await filterToJson(user);

    await user.tab();

    expect(focused()).toBe('language-option-json');
    // The roving tabindex is the mechanism, and it is asserted directly rather than inferred: every
    // option but the active one must be OUT of the tab order, which is the whole difference between
    // one stop and two hundred.
    expect(screen.getByTestId('language-option-json').tabIndex).toBe(0);
    expect(screen.getByTestId('language-option-jsonc').tabIndex).toBe(-1);
  });

  it('Tab out of the list leaves the list rather than moving to the next language', async () => {
    const { user } = mount();
    await openPicker(user);
    await filterToJson(user);
    await user.tab();
    expect(focused()).toBe('language-option-json');

    await user.tab();

    // The E2E could only say "not an option". The active option is the LAST member of the strip's
    // focusable set, so the trap wraps to the first — which is the strip's own language button.
    expect(focused()).not.toMatch(/^language-option-/);
    expect(focused()).toBe(`editor-language-${PANEL}`);
  });
});

describe('the arrows move within it', () => {
  it('ArrowDown and ArrowUp step between the languages', async () => {
    const { user } = mount();
    await openPicker(user);
    await filterToJson(user);
    await user.tab();
    expect(focused()).toBe('language-option-json');

    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('language-option-jsonc');
    // The roving tabindex moved WITH the focus; a version that focused without re-aiming it would
    // leave Tab re-entering the list at the wrong row.
    expect(screen.getByTestId('language-option-jsonc').tabIndex).toBe(0);
    expect(screen.getByTestId('language-option-json').tabIndex).toBe(-1);

    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('language-option-json');
  });

  it('ArrowUp off the TOP goes back to the filter, and ArrowDown comes back in', async () => {
    /*
     * "A door that only opens one way is not a door" (`language-picker.tsx:124`). Both halves are in
     * ONE test on purpose: the return leg is what makes the outward leg a door rather than an exit,
     * and asserting them apart would let a picker that could only be left pass half of it.
     */
    const { user } = mount();
    await openPicker(user);
    await filterToJson(user);
    await user.tab();
    expect(focused()).toBe('language-option-json');

    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe(`language-filter-${PANEL}`);

    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('language-option-json');
  });
});

describe('Tab never leaves the strip', () => {
  it('cycles the strip’s own controls and never reaches the application either side of it', async () => {
    const { user } = mount();
    await openPicker(user);
    await filterToJson(user);

    const seen: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      seen.push(focused());
      expect(insideStrip(), `Tab #${i + 1} left the strip — focus on ${focused()}`).toBe(true);
    }

    /*
     * The SEQUENCE, not merely containment — which is the E2E's blind spot restated as an assertion.
     * The strip's focusable set in document order is: the language button, the word-wrap button, the
     * filter, and the one active option (every other option is `tabIndex -1` and is skipped by
     * `focus-trap.ts:61`). Focus starts in the filter, so the first Tab is an ordinary move onto the
     * active option, the second is at the end of the set and wraps, and the cycle repeats with a
     * period of four. A trap that pinned focus to one control satisfies "still inside" eight times
     * and fails on the first entry here.
     */
    expect(seen).toEqual([
      'language-option-json',
      `editor-language-${PANEL}`,
      `editor-word-wrap-${PANEL}`,
      `language-filter-${PANEL}`,
      'language-option-json',
      `editor-language-${PANEL}`,
      `editor-word-wrap-${PANEL}`,
      `language-filter-${PANEL}`,
    ]);
    // Named explicitly as well as implied by the sequence: these are the two controls a leak would
    // have landed on, and their absence is the claim the E2E was making about the whole window.
    expect(seen).not.toContain('outside-before');
    expect(seen).not.toContain('outside-after');
  });
});

describe('Enter confirms', () => {
  it('applies the active option, closes the picker, renames the strip and persists the override', async () => {
    const { user, calls } = mount();
    expect(languageButton()).toHaveTextContent('Plain Text');
    await openPicker(user);
    await filterToJson(user);

    // Back in through the filter, exactly as the E2E did: ArrowDown aims at the ACTIVE option, which
    // is the one Enter is about to confirm.
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('language-option-json');

    await user.keyboard('{Enter}');

    await waitFor(() => expect(picker()).toBeNull());
    await waitFor(() => expect(languageButton()).toHaveTextContent('JSON'));

    // The half the E2E never asserted: the decision is REMEMBERED, not merely rendered.
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'document.setState')).toEqual([
        {
          method: 'document.setState',
          params: { projectId: PROJECT, relPath: REL_PATH, languageId: 'json' },
        },
      ]),
    );
  });
});
