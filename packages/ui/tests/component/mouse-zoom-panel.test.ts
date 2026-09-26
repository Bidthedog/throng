/**
 * Ctrl+Wheel / Ctrl+MiddleClick drive PANEL zoom on the panel UNDER THE POINTER, read from the live
 * keybindings — 046 iterate round 1, US3 (T118, FR-106, Principle X).
 *
 * ══ WHY THIS IS RED ══
 *
 * `registerMouseZoom` (`packages/ui/src/renderer/main.tsx:44-61`) hard-codes Ctrl+wheel and
 * Ctrl+middle-click to the WINDOW zoom (`window.throng.zoomBy` / `zoomReset`), unconditionally, and
 * never reads a keybinding — so the `Ctrl+WheelUp` / `Ctrl+WheelDown` / `Ctrl+MiddleClick` tokens
 * already shipped on `panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset`
 * (`packages/core/src/config/keybindings.ts:386-388`) are decorative today, and there is no
 * "panel under the pointer" concept anywhere in the gesture path (plan.md: "That is a Principle X
 * gap as well as FR-106's target"). This file imports `MouseZoomHandler` from a new module,
 * `packages/ui/src/renderer/workspace/mouse-zoom.ts`, which does not exist yet — T119's job — so
 * every test below is RED on a rejected import before a single assertion runs.
 *
 * ══ THE INTERFACE THIS FILE ASSUMES (T119's to confirm or adjust) ══
 *
 * `main.tsx`'s `registerMouseZoom` runs at MODULE scope, before the composition root even mounts —
 * outside React, with no access to the workspace store or the live keybindings. Dispatching "the
 * panel-zoom action for that panel's type... through workspace-store.tsx" (T119's own words) needs
 * both, so this file assumes T119 turns it into a mounted component, `MouseZoomHandler(): null`,
 * following the exact shape `KeybindingsHandler` (`app.tsx`) already uses for the equivalent keyboard
 * problem: no props, reads `useKeybindings()` and `useWorkspace()` itself, and is added to the
 * composition root's tree the same way `KeybindingsHandler` is (an `extras` entry here, matching
 * `window-zoom-reset-shift.test.ts`'s harness for the keyboard case).
 *
 * ══ WHAT "THE PANEL UNDER THE POINTER" MEANS HERE ══
 *
 * `panel-placeholder.tsx` marks every mounted panel `data-panel-host={panel.id}`, so
 * `closest('[data-panel-host]')` is how the resolver finds it — a DEDICATED marker (046 fix round,
 * IMPORTANT review finding), not the `data-panel-id` attribute `notification.tsx`'s notice rows also
 * carry purely as a test hook (FR-038): a Ctrl+wheel over one of those must not zoom whatever panel
 * it names. `mountWorkspace` mounts NO panel components (012 US7 — see its own doc comment), so the
 * panel markers below are hand-built divs carrying that same attribute, exactly the device
 * `window-zoom-reset-shift.test.ts` uses for a terminal/editor/find-bar focus surface.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  THRONG_THEME,
  ZOOM_STEP,
  type Keybindings,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import { useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { MouseZoomHandler } from '../../src/renderer/workspace/mouse-zoom.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const SEEDED_ZOOM = 1; // nonzero and off every bound, so a bump/reset is observably different

const bindingsWith = (overrides: Record<string, string[]>): Keybindings => ({
  version: 1,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, ...overrides },
});

function panel(id: string, zoom?: number): Panel {
  return {
    type: 'panel',
    id,
    originProjectId: PROJECT,
    title: id,
    kind: 'editor',
    config: { filePath: `D:/proj/${id}.ts` },
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

/** Two side-by-side panels: `p1` ACTIVE (untouched throughout), `p2` the target of every gesture. */
function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'row',
    sizes: [0.5, 0.5],
    children: [panel('p1'), panel('p2', SEEDED_ZOOM)],
  };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

function Ready(): ReactElement {
  const loaded = useConfigLoaded();
  return createElement('span', { 'data-testid': 'mz-ready', 'data-ready': String(loaded) });
}

let m: MountedWorkspace | undefined;
let zoomBy: ReturnType<typeof vi.fn>;
let zoomReset: ReturnType<typeof vi.fn>;
let p1El: HTMLDivElement;
let p2El: HTMLDivElement;
let titleBarEl: HTMLDivElement;
let sidePaneEl: HTMLDivElement;

async function mount(keybindings?: Keybindings): Promise<void> {
  zoomBy = vi.fn();
  zoomReset = vi.fn();
  m = await mountWorkspace(layout(), {
    extras: [createElement(MouseZoomHandler, { key: 'mz' }), createElement(Ready, { key: 'ready' })],
    throng: keybindings
      ? {
          config: {
            get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme: THRONG_THEME, keybindings }),
            onChange: () => () => {},
          },
          zoomBy,
          zoomReset,
        }
      : { zoomBy, zoomReset },
  });
  await waitFor(() => expect(screen.getByTestId('mz-ready')).toHaveAttribute('data-ready', 'true'));

  // Panel markers — the DOM shape `closest('[data-panel-host]')` reads (`panel-placeholder.tsx`).
  // `data-panel-id` carried too, matching production's SAME div wearing both.
  p1El = document.createElement('div');
  p1El.setAttribute('data-panel-id', 'p1');
  p1El.setAttribute('data-panel-host', 'p1');
  p2El = document.createElement('div');
  p2El.setAttribute('data-panel-id', 'p2');
  p2El.setAttribute('data-panel-host', 'p2');
  titleBarEl = document.createElement('div'); // no markers — stands in for the title bar
  sidePaneEl = document.createElement('div'); // no markers — stands in for a side pane
  document.body.append(p1El, p2El, titleBarEl, sidePaneEl);
}

beforeEach(() => {
  setActivePane('workspace');
});

afterEach(() => {
  p1El?.remove();
  p2El?.remove();
  titleBarEl?.remove();
  sidePaneEl?.remove();
  m?.unmount();
  m = undefined;
});

function wheel(el: HTMLElement, deltaY: number): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.wheel(el, { ctrlKey: true, deltaY, bubbles: true, cancelable: true });
  });
  return notPrevented;
}

function ctrlMiddleClick(el: HTMLElement): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.mouseDown(el, { ctrlKey: true, button: 1, bubbles: true, cancelable: true });
  });
  return notPrevented;
}

/** `panelId`'s zoom, read straight from the store's own layout — not a spy on its methods. */
function zoomOf(panelId: string): number | undefined {
  const root = m!.ws().layout!.tabs[0].root;
  const find = (node: typeof root): Panel | undefined => {
    if ('kind' in node) return node.id === panelId ? node : undefined;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return find(root)?.zoom;
}

describe('Ctrl+Wheel / Ctrl+MiddleClick zoom the panel UNDER THE POINTER (T118, FR-106)', () => {
  it('Ctrl+WheelUp over a non-active panel bumps THAT panel IN, preventDefaults, and never touches the window zoom', async () => {
    await mount();
    const notPrevented = wheel(p2El, -100); // wheel "up" — negative deltaY, the old code's own convention

    expect(notPrevented, 'a panel-zoom gesture must preventDefault, or Chromium sees its own page zoom').toBe(false);
    await waitFor(() => expect(zoomOf('p2')).toBe(SEEDED_ZOOM + ZOOM_STEP));
    expect(zoomOf('p1'), 'the ACTIVE panel is untouched — the pointer named p2, not the active panel').toBeUndefined();
    expect(zoomBy, 'this is a PANEL zoom — the window zoom must never be touched').not.toHaveBeenCalled();
  });

  it('Ctrl+WheelDown over a non-active panel bumps it OUT', async () => {
    await mount();
    wheel(p2El, 100); // wheel "down" — positive deltaY
    await waitFor(() => expect(zoomOf('p2')).toBe(SEEDED_ZOOM - ZOOM_STEP));
    expect(zoomBy).not.toHaveBeenCalled();
  });

  it('Ctrl+MiddleClick resets that panel to its default', async () => {
    await mount();
    const notPrevented = ctrlMiddleClick(p2El);
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(zoomOf('p2')).toBe(0));
    expect(zoomReset, 'this is a PANEL reset — the window zoom reset must never be touched').not.toHaveBeenCalled();
  });

  it('over the title bar, nothing is dispatched — but the event is still consumed [derived: no unhandled Ctrl+wheel reaches Chromium]', async () => {
    await mount();
    const notPrevented = wheel(titleBarEl, -100);
    expect(notPrevented).toBe(false);
    expect(zoomOf('p2')).toBe(SEEDED_ZOOM); // unchanged
    expect(zoomBy).not.toHaveBeenCalled();
  });

  it('over a side pane, nothing is dispatched either', async () => {
    await mount();
    wheel(sidePaneEl, -100);
    expect(zoomOf('p2')).toBe(SEEDED_ZOOM);
    expect(zoomBy).not.toHaveBeenCalled();
    expect(zoomReset).not.toHaveBeenCalled();
  });

  it('reads the LIVE keybindings: with Ctrl+WheelUp removed from panel.zoomIn, the gesture does nothing', async () => {
    await mount(bindingsWith({ 'panel.zoomIn': ['Ctrl+Alt++'] })); // the gesture withdrawn, the chord kept
    wheel(p2El, -100);
    expect(zoomOf('p2'), 'no candidate binding named this gesture, so nothing ran').toBe(SEEDED_ZOOM);
  });

  it('reads the LIVE keybindings: Ctrl+WheelUp REBOUND to panel.zoomReset runs THAT action, not the shipped default', async () => {
    await mount(
      bindingsWith({
        'panel.zoomIn': ['Ctrl+Alt++'], // the gesture moved off zoomIn…
        'panel.zoomReset': ['Ctrl+Alt+0', 'Ctrl+WheelUp'], // …and onto zoomReset
      }),
    );
    wheel(p2El, -100); // still literally Ctrl+WheelUp

    await waitFor(() => expect(zoomOf('p2')).toBe(0)); // RESET, not bumped to SEEDED_ZOOM + ZOOM_STEP
  });
});

/**
 * IMPORTANT fix round finding (review of T119) — FR-108's own note: "a REBOUND [zoom.reset] is left
 * exactly as saved." A user whose saved `keybindings.json` still carries `Ctrl+WheelUp` on
 * `zoom.in`/`zoom.out`/`zoom.reset` (the pre-round shipped default; only an UNTOUCHED document is
 * migrated off the gesture by the upgrade guard) kept the WINDOW-zoom meaning that chord has always
 * had. `actionForGesture` resolves the token to whichever action holds it — including `zoom.in` —
 * but the dispatch switch only ran `panel.*`, so a legacy Ctrl+WheelUp silently did nothing: worse
 * than the pre-round behaviour it replaced, not merely unchanged. These three actions are WINDOW
 * commands (`COMMAND_SCOPES` — `EVERYWHERE`, `isPanelScoped` excludes the `zoom.` prefix) and must
 * fire regardless of whether a panel is under the pointer, exactly like the pre-round hard-coded
 * handler did everywhere in the window.
 */
describe('046 fix round — a legacy Ctrl+Wheel/MiddleClick binding on zoom.in/out/reset still zooms the WINDOW (FR-108)', () => {
  it('Ctrl+WheelUp still bound to zoom.in zooms the window IN, over a panel, and never touches that panel', async () => {
    await mount(bindingsWith({ 'zoom.in': ['Ctrl+Shift+Alt++', 'Ctrl+WheelUp'] }));
    wheel(p2El, -100);

    await waitFor(() => expect(zoomBy).toHaveBeenCalledWith(1));
    expect(zoomOf('p2'), 'a WINDOW gesture — the panel it happened to be over is untouched').toBe(SEEDED_ZOOM);
  });

  it('…and fires with NO panel under the pointer at all — a window command, not a panel one', async () => {
    await mount(bindingsWith({ 'zoom.in': ['Ctrl+Shift+Alt++', 'Ctrl+WheelUp'] }));
    wheel(titleBarEl, -100);

    await waitFor(() => expect(zoomBy).toHaveBeenCalledWith(1));
  });

  it('a legacy Ctrl+WheelDown on zoom.out zooms the window OUT', async () => {
    await mount(bindingsWith({ 'zoom.out': ['Ctrl+Shift+Alt+-', 'Ctrl+WheelDown'] }));
    wheel(p2El, 100);

    await waitFor(() => expect(zoomBy).toHaveBeenCalledWith(-1));
    expect(zoomOf('p2')).toBe(SEEDED_ZOOM);
  });

  it('a legacy Ctrl+MiddleClick on zoom.reset resets the WINDOW zoom, not the panel', async () => {
    await mount(bindingsWith({ 'zoom.reset': ['Ctrl+Shift+Alt+0', 'Ctrl+MiddleClick'] }));
    const notPrevented = ctrlMiddleClick(p2El);

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(zoomReset).toHaveBeenCalledTimes(1));
    expect(zoomOf('p2'), 'the panel is untouched — this is the WINDOW reset').toBe(SEEDED_ZOOM);
  });
});

/**
 * IMPORTANT fix round finding (review of T119) — `notification.tsx`'s notice "affected panels" rows
 * carry `data-panel-id={row.panelId}` purely as a TEST HOOK (its own comment: "not rendered, and not
 * an affordance"), never as a claim that the row IS that panel's host — a notice card is not inside
 * any panel's own DOM subtree. `panelIdUnder`'s original `closest('[data-panel-id]')` could not tell
 * the two apart: `closest` matches the element itself, so hovering a notice row and Ctrl+wheeling
 * would zoom whatever panel THAT row happened to name — possibly one in another tab entirely, one
 * the pointer was never anywhere near.
 */
describe('046 fix round — a notice row naming a panel is not that panel (FR-038, FR-106)', () => {
  it('Ctrl+wheel over a "notice-affected-row"-shaped element (data-panel-id, no data-panel-host) zooms NOTHING', async () => {
    await mount();
    // The exact shape `notification.tsx`'s `<li data-testid="notice-affected-row" data-panel-id=…>`
    // renders — a test hook, not a panel host, so it carries `data-panel-id` alone.
    const noticeRow = document.createElement('li');
    noticeRow.setAttribute('data-testid', 'notice-affected-row');
    noticeRow.setAttribute('data-panel-id', 'p2'); // names p2 — a panel elsewhere, not under the pointer
    document.body.append(noticeRow);

    try {
      const notPrevented = wheel(noticeRow, -100);
      expect(notPrevented, 'still consumed — Chromium must not see its own page zoom either').toBe(false);
      expect(zoomOf('p2'), 'the row NAMES p2, but is not p2 — nothing must move').toBe(SEEDED_ZOOM);
      expect(zoomBy).not.toHaveBeenCalled();
    } finally {
      noticeRow.remove();
    }
  });
});

/**
 * MINOR fix round finding (review of T119) — `deltaY === 0` (a tilt-wheel / horizontal-swipe event,
 * ctrl held) was treated as `WheelDown` by `event.deltaY < 0 ? 'WheelUp' : 'WheelDown'` — `0` is not
 * `< 0`. A horizontal gesture carries no vertical intent at all and must be ignored outright, not
 * silently read as "zoom out".
 */
describe('046 fix round — a horizontal wheel/tilt event (deltaY 0) is ignored, not treated as WheelDown', () => {
  it('does nothing — no dispatch, and the event is left alone', async () => {
    await mount();
    const notPrevented = wheel(p2El, 0);

    expect(notPrevented, 'not a vertical zoom gesture — nothing here claims it').toBe(true);
    expect(zoomOf('p2')).toBe(SEEDED_ZOOM);
    expect(zoomBy).not.toHaveBeenCalled();
  });
});
