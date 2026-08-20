/**
 * How the language picker is DISMISSED — the outside click, the toggle, and the click that must not
 * dismiss it (016 FR-010/FR-011; 018 FR-013 follow-up).
 *
 * PLACE AT: `packages/ui/tests/component/status-strip-picker-dismissal.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/editor-language-override.e2e.ts:349` —
 * `the language picker closes when you click anywhere off it` (034 FR-045).
 *
 * ══ WHY THIS ONE COMES DOWN ══
 *
 * It launched Electron, started a daemon, made a real temp project and opened a real CodeMirror
 * document — and then asserted three facts about `useState` and a `document.addEventListener`. The
 * subject is `status-strip.tsx:117-125`: one `mousedown` listener, in capture, asking whether the
 * event landed inside the STRIP. No layout is measured, no OS focus is moved between panels, no
 * daemon is consulted. The E2E clicked `.cm-content` merely because it needed somewhere that was
 * plainly "not the menu"; a bare sibling `<div>` is the same click.
 *
 * ══ VERIFIED NOT ALREADY COVERED (034 FR-046a) ══
 *
 * `packages/ui/tests/component/picker.test.ts:168` — *"dismisses on Escape without choosing"* — is
 * about a DIFFERENT component (`common/picker.tsx`, the Quick Open / tab typeahead) and about a
 * different gesture. The language picker is `editor/language-picker.tsx`, and its Escape handler is
 * its own (`language-picker.tsx:151`). Nothing anywhere below E2E touched the outside-click.
 *
 * ══ WHERE THIS LANDS STRONGER THAN THE E2E DID ══
 *
 *   - The E2E asserted the picker was gone after a click on the document. That is equally satisfied
 *     by a listener that closes on EVERY mousedown, including one on the picker's own filter box —
 *     which would make the filter unusable. The E2E did test the inside click, but only after
 *     re-opening; here the two are asserted as one mechanism, in the order that distinguishes them.
 *   - The toggle test names the failure it exists to catch: a listener that watched only the MENU
 *     would close on `mousedown` on the strip button and let the button's own `click` reopen it, so
 *     the picker would appear to ignore its own control. That is asserted as "the second click
 *     leaves it closed", which is the observable difference.
 *
 * ══ WHAT DOES NOT COME DOWN FROM THAT FILE ══
 *
 * The other six tests in `editor-language-override.e2e.ts` all stay: five assert a computed colour,
 * a computed background, or truncation at a real width (Principle V's real-layout-and-text-rendering
 * reserve, and FR-049 forbids `getComputedStyle` here outright); the sixth survives a real restart.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, render the strip WITHOUT the `ServicesProvider` wrapper. `LanguagePicker`
 * calls `useServices()` at its first render, which throws `useServices must be used within a
 * ServicesProvider` — and every test here opens the picker as its first action. **ALL FOUR tests
 * fail.** The "still visible" and "no longer present" assertions cannot both be satisfied by an
 * empty document: each test asserts the picker PRESENT before asserting anything about it going
 * away, so a strip that rendered nothing fails on the positive half.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLanguage } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import {
  claimTransientOverlay,
  transientOverlayOpen,
} from '../../src/renderer/common/transient-overlay.js';
import {
  removePanelLanguage,
  setPanelLanguage,
} from '../../src/renderer/editor/editor-language.js';
import { __resetTransientOverlayForTests } from '../../src/renderer/common/transient-overlay.js';

const PANEL = 'panel-1';
const PROJECT = 'proj-1';

/**
 * A bridge that REJECTS everything.
 *
 * Nothing in these four tests may legitimately reach the daemon — the picker only talks to it when a
 * language is CHOSEN, and no test here chooses one. A resolving stub would hide a change that started
 * persisting on open; a rejecting one names it.
 */
function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
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
  // The picker claims the window's one transient-overlay slot; a test that failed mid-way would
  // otherwise leave it claimed for the next one.
  __resetTransientOverlayForTests();
});

function mount() {
  // The strip renders whatever the language store says this panel resolved to — seeded through the
  // REAL resolver so the label is the one production would draw for `main.rs`.
  setPanelLanguage(PANEL, resolveLanguage({ fileName: 'main.rs' }));

  const user = userEvent.setup();
  render(
    // ANTI-VACUITY CONTROL: drop this `ServicesProvider` element and `useServices` throws inside
    // `LanguagePicker`, failing all four tests. See the file header.
    createElement(
      ServicesProvider,
      { services: fakeServices() },
      createElement(
        'div',
        null,
        createElement(StatusStrip, {
          key: 'strip',
          panelId: PANEL,
          projectId: PROJECT,
          relPath: 'main.rs',
        }),
        // Somewhere plainly "not the menu" — the E2E used `.cm-content` for exactly this and nothing
        // more. A <div> is deliberate: a focusable element here would drag the strip's focus trap
        // into a test that is not about focus.
        createElement('div', { key: 'outside', 'data-testid': 'outside' }, 'outside'),
      ),
    ),
  );
  return { user };
}

const strip = (): HTMLElement => screen.getByTestId(`editor-language-${PANEL}`);
const picker = (): HTMLElement | null => screen.queryByTestId(`language-picker-${PANEL}`);

async function openPicker(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(strip());
  await waitFor(() => expect(picker()).not.toBeNull());
}

describe('opening it', () => {
  it('draws the picker, with its filter and its options, from the strip’s language button', async () => {
    /*
     * The presence anchor for the whole file. Every other test here ends in an ABSENCE, and an
     * absence assertion against a strip that never rendered is satisfied by nothing at all.
     */
    const { user } = mount();
    expect(strip()).toHaveTextContent('Rust');
    expect(picker()).toBeNull();

    await openPicker(user);

    expect(screen.getByTestId(`language-filter-${PANEL}`)).toBeVisible();
    expect(screen.getByTestId('language-option-plaintext')).toBeVisible();
  });
});

describe('dismissing it', () => {
  it('closes when you click anywhere off the strip', async () => {
    // MIGRATED FROM `editor-language-override.e2e.ts:349`, first half.
    const { user } = mount();
    await openPicker(user);

    await user.click(screen.getByTestId('outside'));

    await waitFor(() => expect(picker()).toBeNull());
  });

  it('still TOGGLES from its own button — it does not close and instantly reopen', async () => {
    /*
     * MIGRATED FROM the same test's second half, and the reason the listener watches the whole STRIP
     * rather than the menu (`status-strip.tsx:100-105`). Watching only the menu treats a click on
     * the button as "outside": the menu closes on `mousedown` and the button's `click` reopens it,
     * so the control appears inert. The observable difference is exactly this — after the SECOND
     * click the picker must be gone.
     */
    const { user } = mount();
    await openPicker(user);

    await user.click(strip());
    await waitFor(() => expect(picker()).toBeNull());

    // …and it opens again, so the toggle is a toggle rather than a one-way door.
    await user.click(strip());
    await waitFor(() => expect(picker()).not.toBeNull());
  });

  it('does NOT close when you click inside it, so the filter stays usable', async () => {
    /*
     * MIGRATED FROM the same test's third half. Without this, a listener that closed on EVERY
     * mousedown passes the outside-click test above and makes the picker impossible to use: the
     * first click into the filter box would dismiss it.
     */
    const { user } = mount();
    await openPicker(user);

    const filter = screen.getByTestId(`language-filter-${PANEL}`);
    await user.click(filter);
    expect(picker()).not.toBeNull();

    await user.type(filter, 'rus');
    expect(picker()).not.toBeNull();
    // The filter really filtered — otherwise "still open" would be true of a picker that had stopped
    // responding to input at all.
    expect(screen.getByTestId('language-option-rust')).toBeVisible();
    expect(screen.queryByTestId('language-option-plaintext')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The picker PARTICIPATES in the one-overlay rule
 * (033 FR-071/FR-071a — migrated from transient-overlays.e2e.ts:291, 035 T056)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE DEFECT FR-071 EXISTS FOR ══
 *
 * A user pressed `Ctrl+Alt+T` and then `Ctrl+Shift+T` and got two focus-trapped modals on screen at
 * once. FR-066 had promised "exactly one modal" and scoped the promise to the two NEW modals, so
 * every other overlay was outside it.
 *
 * ══ WHY THIS IS TESTED AGAINST THE REGISTRY AND NOT AGAINST QUICK OPEN ══
 *
 * The E2E asserted the pair: open the language picker, open Quick Open, watch the picker go. That is
 * one ordered pair out of a set that grows quadratically with every overlay added — and testing it
 * pairwise is exactly the coupling **FR-071a forbids**, which says a feature must not import another
 * feature's store to know whether to close.
 *
 * The rule is one shared slot. `unit/transient-overlay.test.ts` proves the slot's mechanics — five
 * tests, including an incumbent whose dismiss throws, and a superseded release being a no-op. What
 * it cannot say is whether any given overlay is WIRED to it.
 *
 * So this claims exactly that, from the picker's own side: something else claimed the slot, and the
 * picker let go. It never mentions Quick Open, needs no second feature mounted, and would hold
 * identically for an overlay written next year.
 *
 * ── AND A GUARD THAT IS DELIBERATELY NOT HERE ──
 *
 * The obvious next step is a source guard: every component rendering a `.modal-overlay` must call
 * `useTransientOverlay`. It was investigated and NOT written, because it would be wrong. Five files
 * render that scrim and only three participate — `confirm-dialog.tsx`, `app-close-prompt.tsx` and
 * `project-settings-dialog.tsx` are MODAL rather than transient, and a confirmation that dismissed
 * itself because someone opened Quick Open would be a worse defect than the one FR-071 fixed. The
 * codebase does not mark that distinction anywhere, so the guard would encode a guess about which
 * kind each new overlay is.
 */
describe('the language picker holds the shared overlay slot (FR-071)', () => {
  it('closes when ANOTHER overlay claims the slot', async () => {
    const { user } = mount();
    await openPicker(user);
    expect(picker(), 'the picker must be open for this to be about closing it').toBeTruthy();

    // Any other overlay opening. Deliberately anonymous: the picker must not care which.
    let release: (() => void) | undefined;
    act(() => {
      release = claimTransientOverlay(() => {});
    });

    await waitFor(() => expect(picker()).toBeNull());
    act(() => release?.());
  });

  it('takes the slot when it opens, so the NEXT overlay can displace it', async () => {
    /*
     * The other half, and the one that makes the first half non-trivial: a picker that closed on any
     * claim but never claimed anything itself would pass the test above while leaving the slot empty
     * — so the overlay after it would find nothing to dismiss and the two would stack, which is the
     * original defect.
     */
    const { user } = mount();
    expect(transientOverlayOpen(), 'nothing should hold the slot before the picker opens').toBe(
      false,
    );

    await openPicker(user);

    expect(transientOverlayOpen()).toBe(true);
  });

  it('releases the slot when it closes on its own, leaving nothing to dismiss', async () => {
    /*
     * A picker that kept the slot after closing would make the NEXT overlay dismiss a corpse — and
     * `transient-overlay.test.ts` proves a stale release is a no-op, not that anyone releases.
     */
    const { user } = mount();
    await openPicker(user);
    expect(transientOverlayOpen()).toBe(true);

    await user.click(screen.getByTestId('outside'));

    await waitFor(() => expect(picker()).toBeNull());
    expect(transientOverlayOpen()).toBe(false);
  });
});
