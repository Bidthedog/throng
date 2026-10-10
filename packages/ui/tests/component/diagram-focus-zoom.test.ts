/**
 * 054 MT-04 A5 — the panel zoom chords and Ctrl+wheel zoom just a FOCUSED diagram, not the whole panel.
 *
 * Layer: component — the two real routes (`KeybindingsHandler`'s window key listener and
 * `MouseZoomHandler`'s wheel / middle-click listener) are mounted and driven by events; jsdom is enough
 * because the question is only "which of two zooms runs", answered by `document.activeElement`. The
 * diagram's own zoom maths and its registration are `preview-diagram-frame.test.ts`'s; here a stand-in
 * registers under the same key, so a failure points at the routing, not at the frame.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { useConfigLoaded } from '../../src/renderer/config/config-store.js';
import {
  DIAGRAM_ZOOM_KEY_ATTR,
  diagramZoomKey,
  registerDiagramZoom,
  type DiagramZoomAction,
} from '../../src/renderer/preview/diagram/diagram-zoom.js';
import { MouseZoomHandler } from '../../src/renderer/workspace/mouse-zoom.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;
let panelEl: HTMLDivElement;
let diagramEl: HTMLDivElement;
let diagramViewport: HTMLDivElement;
let outsideInput: HTMLButtonElement;
let unregister: (() => void) | undefined;
let diagramZoom: ReturnType<typeof vi.fn<(a: DiagramZoomAction) => void>>;
let bumpZoom: ReturnType<typeof vi.fn>;
let resetZoom: ReturnType<typeof vi.fn>;

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const p: Panel = { type: 'panel', id: 'p1', originProjectId: PROJECT, title: 'p1', kind: 'editor', config: { filePath: 'D:/proj/a.md' } };
  l.tabs[0].root = p;
  l.tabs[0].activePanelId = 'p1';
  return l;
}

function Ready(): ReactElement {
  const loaded = useConfigLoaded();
  return createElement('span', { 'data-testid': 'dz-ready', 'data-ready': String(loaded) });
}

async function mount(): Promise<void> {
  m = await mountWorkspace(layout(), {
    extras: [
      createElement(KeybindingsHandler, {
        key: 'keys',
        onToggleProjects: () => {},
        onToggleExplorer: () => {},
        onRevealLeft: () => {},
        onRevealRight: () => {},
      }),
      createElement(MouseZoomHandler, { key: 'mz' }),
      createElement(Ready, { key: 'ready' }),
    ],
    throng: {},
  });
  await waitFor(() => expect(screen.getByTestId('dz-ready')).toHaveAttribute('data-ready', 'true'));
  bumpZoom = vi.spyOn(m.ws(), 'bumpZoom') as unknown as ReturnType<typeof vi.fn>;
  resetZoom = vi.spyOn(m.ws(), 'resetZoom') as unknown as ReturnType<typeof vi.fn>;

  // A panel host holding a diagram frame (with its focusable viewport) and a control outside the diagram.
  panelEl = document.createElement('div');
  panelEl.setAttribute('data-panel-host', 'p1');
  diagramEl = document.createElement('div');
  diagramEl.setAttribute(DIAGRAM_ZOOM_KEY_ATTR, diagramZoomKey('p1', 'diagram-0'));
  diagramViewport = document.createElement('div');
  diagramViewport.tabIndex = 0;
  diagramEl.append(diagramViewport);
  outsideInput = document.createElement('button');
  panelEl.append(diagramEl, outsideInput);
  document.body.append(panelEl);

  diagramZoom = vi.fn<(a: DiagramZoomAction) => void>();
  unregister = registerDiagramZoom(diagramZoomKey('p1', 'diagram-0'), diagramZoom);
}

afterEach(() => {
  unregister?.();
  panelEl?.remove();
  m?.unmount();
  m = undefined;
});

/** The keydowns a US keyboard sends for the three shipped panel-zoom chords (as window-zoom-reset-shift.test.ts presses them). */
const CHORDS = {
  in: { key: '=', code: 'Equal' },
  out: { key: '-', code: 'Minus' },
  reset: { key: '0', code: 'Numpad0' },
} as const;

function chord(el: HTMLElement, which: keyof typeof CHORDS): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(el, { ...CHORDS[which], ctrlKey: true, altKey: true, bubbles: true });
  });
  return notPrevented;
}

function wheel(el: HTMLElement, deltaY: number): void {
  act(() => {
    fireEvent.wheel(el, { ctrlKey: true, deltaY, bubbles: true, cancelable: true });
  });
}

describe('panel zoom chords with a diagram focused', () => {
  it.each([
    ['Ctrl+Alt++', 'in'],
    ['Ctrl+Alt+-', 'out'],
    ['Ctrl+Alt+Numpad0', 'reset'],
  ] as const)('%s zooms the diagram (%s), is consumed, and leaves the panel zoom alone', async (_label, action) => {
    await mount();
    diagramViewport.focus();
    const notPrevented = chord(diagramViewport, action);
    expect(notPrevented).toBe(false);
    expect(diagramZoom).toHaveBeenCalledExactlyOnceWith(action);
    expect(bumpZoom).not.toHaveBeenCalled();
    expect(resetZoom).not.toHaveBeenCalled();
  });

  // One chord per mount: `bumpZoom` is a spy on the live store, and the first press's state change hands the
  // handler a new store object whose methods are unspied (see window-zoom-reset-shift.test.ts).
  it('with focus elsewhere in the panel Ctrl+Alt++ zooms the panel, as before', async () => {
    await mount();
    outsideInput.focus();
    chord(outsideInput, 'in');
    expect(bumpZoom).toHaveBeenCalledWith('p1', 1);
    expect(diagramZoom).not.toHaveBeenCalled();
  });

  it('with focus elsewhere in the panel Ctrl+Alt+Numpad0 resets the panel, as before', async () => {
    await mount();
    outsideInput.focus();
    chord(outsideInput, 'reset');
    expect(resetZoom).toHaveBeenCalledWith('p1');
    expect(diagramZoom).not.toHaveBeenCalled();
  });
});

describe('Ctrl+wheel / Ctrl+middle-click with a diagram focused', () => {
  it('Ctrl+wheel up / down and Ctrl+middle-click zoom the diagram in / out / to 100%', async () => {
    await mount();
    diagramViewport.focus();
    wheel(diagramViewport, -100);
    wheel(diagramViewport, 100);
    act(() => {
      fireEvent.mouseDown(diagramViewport, { ctrlKey: true, button: 1, bubbles: true, cancelable: true });
    });
    expect(diagramZoom.mock.calls.map((c) => c[0])).toEqual(['in', 'out', 'reset']);
    expect(bumpZoom).not.toHaveBeenCalled();
    expect(resetZoom).not.toHaveBeenCalled();
  });

  it('with focus elsewhere the wheel zooms the panel under the pointer, as before', async () => {
    await mount();
    outsideInput.focus();
    wheel(outsideInput, -100);
    await waitFor(() => expect(bumpZoom).toHaveBeenCalledWith('p1', 1));
    expect(diagramZoom).not.toHaveBeenCalled();
  });
});
