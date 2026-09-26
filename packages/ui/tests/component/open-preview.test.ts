/**
 * 044 T073 — `openPreview()` and the two messages main sends a window about placement (FR-010 –
 * FR-014, FR-090c; contracts/preview-ipc.md §1 `open`, §2 `place` / `focus`).
 *
 * ══ WHAT IS REAL AND WHAT IS FAKE ══
 *
 * The bridge is a fake answering whatever each test says main decided — main's decision itself is
 * `preview-service`'s and is integration-tested there. The WORKSPACE is a small store over core's real
 * layout operations (`addPanel`, `addPanelBeside`, `setPanelType`, …), so every assertion below reads a
 * real layout — where the preview landed, which tab is in front, which panel is active — rather than
 * which store method happened to be called.
 *
 * Focus is observed at the panel-focus registry: a focus callback is registered for the panel id the
 * test expects to receive it, exactly as a mounted preview body registers one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  addPanel as opAddPanel,
  addPanelBeside as opAddPanelBeside,
  collectPanels,
  createDefaultLayout,
  effectiveActivePanelId,
  setActivePanel as opSetActivePanel,
  setActiveTab as opSetActiveTab,
  setPanelType as opSetPanelType,
  type Panel,
  type PanelConfig,
  type PanelKind,
  type PreviewOpenRequest,
  type PreviewOpenResponse,
  type WorkspaceLayout,
} from '@throng/core';
import {
  handlePreviewFocus,
  handlePreviewPlace,
  openPreview,
  type PreviewPlacementWorkspace,
} from '../../src/renderer/preview/open-preview.js';
import { previewReservationFor, __resetPreviewReservations } from '../../src/renderer/preview/preview-reservations.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { registerPreviewPanelHandles } from '../../src/renderer/preview/preview-panel-handles.js';

const PROJECT = 'proj-1';
const FILE = 'D:/proj/README.md';

/* ── The layout: two tabs, the parent editor in the BACKGROUND one ─────────────────────────── */

const panel = (id: string, over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: `Panel ${id}`,
  ...over,
});

function twoTabs(): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'front' });
  return {
    ...base,
    tabs: [
      { id: 't1', title: 'Tab 1', root: panel('front', { kind: 'terminal' }) },
      {
        id: 't2',
        title: 'Tab 2',
        root: {
          type: 'split',
          orientation: 'row',
          sizes: [0.5, 0.5],
          children: [panel('other'), panel('ed', { kind: 'editor', config: { filePath: FILE } })],
        },
      },
    ],
    activeTabId: 't1',
  };
}

/* ── A workspace store over core's real operations ───────────────────────────────────────────── */

function fakeWs(initial: WorkspaceLayout) {
  let layout = initial;
  let next = 0;
  const calls: string[] = [];
  const ws: PreviewPlacementWorkspace & { calls: string[] } = {
    calls,
    get layout() {
      return layout;
    },
    // As the real store does: the new panel belongs to `originProjectId` when one is named, and to the
    // layout's own project (a sub-workspace's is `subworkspace:<id>`) when not.
    addPanel(tabId: string, originProjectId?: string): string {
      calls.push('addPanel');
      const id = `new-${++next}`;
      layout = opAddPanel(layout, tabId, id, originProjectId);
      return id;
    },
    addPanelBeside(targetId: string, edge: 'left' | 'right', originProjectId?: string): string | null {
      calls.push('addPanelBeside');
      const target = layout.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === targetId);
      if (!target) return null;
      const id = `new-${++next}`;
      layout = opAddPanelBeside(layout, targetId, edge, panel(id, { originProjectId: originProjectId ?? target.originProjectId }));
      return id;
    },
    clearLastAddedPanel(): void {
      calls.push('clearLastAddedPanel');
    },
    setPanelType(panelId: string, kind: PanelKind, config: PanelConfig): void {
      calls.push('setPanelType');
      layout = opSetPanelType(layout, panelId, kind, config);
    },
    setActiveTab(tabId: string): void {
      calls.push('setActiveTab');
      layout = opSetActiveTab(layout, tabId);
    },
    setActivePanel(tabId: string, panelId: string): void {
      calls.push('setActivePanel');
      layout = opSetActivePanel(layout, tabId, panelId);
    },
  };
  return ws;
}

const allPanels = (l: WorkspaceLayout): Panel[] => l.tabs.flatMap((t) => collectPanels(t.root) as Panel[]);
const tabOf = (l: WorkspaceLayout, id: string) => l.tabs.find((t) => collectPanels(t.root).some((p) => p.id === id));

function fakeBridge(answer: PreviewOpenResponse) {
  return {
    open: vi.fn((_req: PreviewOpenRequest) => Promise.resolve(answer)),
    placeDeclined: vi.fn(),
  };
}

let focused: string[];
const watchFocus = (...ids: string[]): void => {
  for (const id of ids) registerPanelFocus(id, () => focused.push(id));
};

beforeEach(() => {
  focused = [];
  __resetPreviewReservations();
  Reflect.set(window, 'throng', { panel: { notifyTyped: vi.fn() } });
});
afterEach(() => {
  // Every registration, and the one focus request the registry parks module-wide, so no test inherits
  // the previous test's focus.
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

/* ── open ─────────────────────────────────────────────────────────────────────────────────────── */

describe('placeLocally beside a parent this window holds (FR-010)', () => {
  it('splits the parent’s slot with the preview on the RIGHT, parent’s tab to the front, preview focused', async () => {
    const ws = fakeWs(twoTabs());
    const bridge = fakeBridge({ kind: 'placeLocally', reservation: 'r-1', besidePanelId: 'ed' });
    watchFocus('new-1');

    const outcome = await openPreview({
      ws,
      bridge,
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });

    expect(bridge.open).toHaveBeenCalledWith({
      absPath: FILE,
      projectId: PROJECT,
      requesterPanelId: 'ed',
      hasParentLocally: true,
    });
    expect(outcome).toEqual({ kind: 'placed', panelId: 'new-1' });

    const l = ws.layout as WorkspaceLayout;
    const t2 = l.tabs.find((t) => t.id === 't2');
    // The parent's slot is now a row of [editor, preview]; the sibling that was there is untouched.
    const ids = collectPanels(t2!.root).map((p) => p.id);
    expect(ids).toEqual(['other', 'ed', 'new-1']);
    const preview = allPanels(l).find((p) => p.id === 'new-1');
    expect(preview).toMatchObject({ kind: PREVIEW_KIND, config: { filePath: FILE }, originProjectId: PROJECT });

    expect(l.activeTabId).toBe('t2');
    expect(effectiveActivePanelId(t2!)).toBe('new-1');
    expect(focused).toEqual(['new-1']);
    // A preview created by a command must not open in rename mode (FR-041 is for user-added panels).
    expect(ws.calls).toContain('clearLastAddedPanel');
  });

  it('hands the mounting preview main’s reservation, so its attach consumes it (FR-012)', async () => {
    const ws = fakeWs(twoTabs());
    await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'placeLocally', reservation: 'r-1', besidePanelId: 'ed' }),
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });
    expect(previewReservationFor('new-1')).toBe('r-1');
  });

  it('mirrors the new typed panel to other windows, as every created panel is', async () => {
    const ws = fakeWs(twoTabs());
    await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'placeLocally', reservation: 'r-1', besidePanelId: 'ed' }),
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });
    const notifyTyped = (window.throng as unknown as { panel: { notifyTyped: ReturnType<typeof vi.fn> } }).panel
      .notifyTyped;
    // The placing layout rides with it, so a window that later holds a synced view of this panel knows
    // the run is not its to end (review finding 2, `forget-preview-panel.ts`).
    expect(notifyTyped).toHaveBeenCalledWith('new-1', PREVIEW_KIND, { filePath: FILE, placedInLayoutProjectId: PROJECT });
  });
});

describe('placement falls back to a local view of the parent (fix round 1, items 2 and 4)', () => {
  it('beside the local editor for the file when main names a view in another window and nobody requested it (FR-010)', async () => {
    const ws = fakeWs(twoTabs());
    watchFocus('new-1');

    // The File Explorer chord (and Open In → Preview): no requester. Main's registry recorded the
    // document's panel in ANOTHER window, but this window shows the file too.
    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'placeLocally', reservation: 'r-3', besidePanelId: 'elsewhere' }),
      intent: { absPath: FILE, projectId: PROJECT },
    });

    expect(outcome).toEqual({ kind: 'placed', panelId: 'new-1' });
    const l = ws.layout as WorkspaceLayout;
    expect(collectPanels(l.tabs.find((t) => t.id === 't2')!.root).map((p) => p.id)).toEqual(['other', 'ed', 'new-1']);
    expect(l.activeTabId).toBe('t2');
  });

  it('reads the layout AFTER main answers, from a workspace getter — not the one captured before the await', async () => {
    // The window's store object is replaced on every render; a layout captured before `open` resolved
    // does not hold a tab added while main was deciding.
    const early = fakeWs(createDefaultLayout(PROJECT, { tab: 't1', panel: 'front' }));
    const late = fakeWs(twoTabs());
    let current = early;
    const bridge = {
      open: vi.fn(async () => {
        current = late;
        return { kind: 'placeLocally' as const, reservation: 'r-4', besidePanelId: 'ed' };
      }),
      placeDeclined: vi.fn(),
    };

    const outcome = await openPreview({ ws: () => current, bridge, intent: { absPath: FILE, projectId: PROJECT } });

    expect(outcome).toEqual({ kind: 'placed', panelId: 'new-1' });
    expect(early.calls).toEqual([]);
    expect(collectPanels((late.layout as WorkspaceLayout).tabs[1]!.root).map((p) => p.id)).toEqual(['other', 'ed', 'new-1']);
  });
});

describe('placeLocally standalone (FR-011)', () => {
  it('appends the preview at the ACTIVE tab’s root, where a new editor would go, and focuses it', async () => {
    const ws = fakeWs(twoTabs());
    const bridge = fakeBridge({ kind: 'placeLocally', reservation: 'r-2', besidePanelId: null });
    watchFocus('new-1');
    const other = 'D:/proj/docs/guide.md';

    const outcome = await openPreview({ ws, bridge, intent: { absPath: other, projectId: PROJECT } });

    expect(bridge.open).toHaveBeenCalledWith({ absPath: other, projectId: PROJECT, hasParentLocally: false });
    expect(outcome).toEqual({ kind: 'placed', panelId: 'new-1' });
    const l = ws.layout as WorkspaceLayout;
    expect(tabOf(l, 'new-1')?.id).toBe('t1');
    expect(collectPanels(l.tabs[0]!.root).map((p) => p.id)).toEqual(['front', 'new-1']);
    expect(allPanels(l).find((p) => p.id === 'new-1')).toMatchObject({ kind: PREVIEW_KIND, config: { filePath: other } });
    expect(ws.calls).not.toContain('addPanelBeside');
    expect(l.activeTabId).toBe('t1');
    expect(effectiveActivePanelId(l.tabs[0]!)).toBe('new-1');
    expect(focused).toEqual(['new-1']);
    expect(previewReservationFor('new-1')).toBe('r-2');
  });
});

/*
 * Adversarial review (renderer) I-1. A sub-workspace window's layout belongs to `subworkspace:<id>`, not to a
 * project, so a panel added there with no project named belongs to the sub-workspace. A preview placed that
 * way attached as outside every project, was refused, and vanished with no notice — while Quick Open counted
 * it opened. The preview belongs to the project main validated the request against.
 */
describe('placement in a sub-workspace window takes the REQUEST’s project, not the layout’s (review I-1)', () => {
  const SUB = 'subworkspace:sw-1';

  function subWorkspace(): WorkspaceLayout {
    const base = createDefaultLayout(SUB, { tab: 't1', panel: 'front' });
    return { ...base, tabs: [{ id: 't1', title: 'Tab 1', root: panel('front', { originProjectId: SUB }) }], activeTabId: 't1' };
  }

  it('a standalone placeLocally gives the preview the intent’s project id', async () => {
    const ws = fakeWs(subWorkspace());

    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'placeLocally', reservation: 'r-sw', besidePanelId: null }),
      intent: { absPath: FILE, projectId: PROJECT },
    });

    expect(outcome).toEqual({ kind: 'placed', panelId: 'new-1' });
    expect(allPanels(ws.layout as WorkspaceLayout).find((p) => p.id === 'new-1')).toMatchObject({
      kind: PREVIEW_KIND,
      originProjectId: PROJECT,
      // …and THIS window's layout is recorded as the one that placed it, which is the only thing that
      // still says so after a relaunch: by origin it is indistinguishable from a project preview synced
      // in, whose run the project window would still hold (review finding 2).
      config: { placedInLayoutProjectId: SUB },
    });
  });

  it('main’s standalone place fallback gives the preview the message’s project id', () => {
    const ws = fakeWs(subWorkspace());
    const bridge = fakeBridge({ kind: 'placedElsewhere' });

    expect(
      handlePreviewPlace(ws, bridge, { requestId: 'req-sw', absPath: FILE, projectId: PROJECT, besidePanelId: null, reservation: 'r-sw' }),
    ).toBe(true);

    expect(allPanels(ws.layout as WorkspaceLayout).find((p) => p.id === 'new-1')).toMatchObject({
      kind: PREVIEW_KIND,
      originProjectId: PROJECT,
    });
  });
});

describe('focused — the file already has its one preview (FR-012, FR-014)', () => {
  function withPreviewInBackground(): WorkspaceLayout {
    const l = twoTabs();
    return {
      ...l,
      tabs: l.tabs.map((t) =>
        t.id === 't2'
          ? {
              ...t,
              root: {
                type: 'split' as const,
                orientation: 'row' as const,
                sizes: [0.5, 0.5],
                children: [panel('ed', { kind: 'editor', config: { filePath: FILE } }), panel('pv', { kind: PREVIEW_KIND, config: { filePath: FILE } })],
              },
            }
          : t,
      ),
    };
  }

  it('with a panel id: brings its tab to the front and focuses it, placing nothing', async () => {
    const ws = fakeWs(withPreviewInBackground());
    watchFocus('pv');

    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'focused', panelId: 'pv' }),
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });

    expect(outcome).toEqual({ kind: 'focused', panelId: 'pv' });
    const l = ws.layout as WorkspaceLayout;
    expect(l.activeTabId).toBe('t2');
    expect(effectiveActivePanelId(l.tabs.find((t) => t.id === 't2')!)).toBe('pv');
    expect(focused).toEqual(['pv']);
    expect(ws.calls).not.toContain('addPanel');
    expect(ws.calls).not.toContain('addPanelBeside');
    expect(allPanels(l)).toHaveLength(3);
  });

  it('with panelId null (a reservation only): changes nothing, looks nothing up, focuses nothing', async () => {
    const before = withPreviewInBackground();
    const ws = fakeWs(before);
    watchFocus('pv', 'ed');

    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'focused', panelId: null }),
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });

    expect(outcome).toEqual({ kind: 'focused', panelId: null });
    expect(ws.layout).toBe(before);
    expect(ws.calls).toEqual([]);
    expect(focused).toEqual([]);
  });
});

describe('refused and placedElsewhere change nothing here', () => {
  it('refused: no layout change', async () => {
    const before = twoTabs();
    const ws = fakeWs(before);
    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'refused', reason: 'disabled' }),
      intent: { absPath: FILE, projectId: PROJECT, requesterPanelId: 'ed' },
    });
    expect(outcome).toEqual({ kind: 'refused', reason: 'disabled' });
    expect(ws.layout).toBe(before);
    expect(ws.calls).toEqual([]);
  });

  it('placedElsewhere: no layout change — the window holding the parent places it', async () => {
    const before = twoTabs();
    const ws = fakeWs(before);
    const outcome = await openPreview({
      ws,
      bridge: fakeBridge({ kind: 'placedElsewhere' }),
      intent: { absPath: 'D:/proj/elsewhere.md', projectId: PROJECT },
    });
    expect(outcome).toEqual({ kind: 'placedElsewhere' });
    expect(ws.layout).toBe(before);
    expect(ws.calls).toEqual([]);
  });

  it('with no preview bridge (a test window, the preferences window): does nothing', async () => {
    const before = twoTabs();
    const ws = fakeWs(before);
    const outcome = await openPreview({ ws, bridge: undefined, intent: { absPath: FILE, projectId: PROJECT } });
    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(ws.layout).toBe(before);
  });
});

/* ── place (main → this window) ──────────────────────────────────────────────────────────────── */

describe('an incoming place (FR-010)', () => {
  const place = { requestId: 'req-1', absPath: FILE, projectId: PROJECT, besidePanelId: 'ed', reservation: 'r-9' };

  it('places beside a parent this window holds, brings its tab forward, and attaches with the reservation', () => {
    const ws = fakeWs(twoTabs());
    const bridge = fakeBridge({ kind: 'placedElsewhere' });
    watchFocus('new-1');

    expect(handlePreviewPlace(ws, bridge, place)).toBe(true);

    const l = ws.layout as WorkspaceLayout;
    expect(collectPanels(l.tabs.find((t) => t.id === 't2')!.root).map((p) => p.id)).toEqual(['other', 'ed', 'new-1']);
    expect(allPanels(l).find((p) => p.id === 'new-1')).toMatchObject({ kind: PREVIEW_KIND, config: { filePath: FILE } });
    expect(l.activeTabId).toBe('t2');
    expect(focused).toEqual(['new-1']);
    expect(previewReservationFor('new-1')).toBe('r-9');
    expect(bridge.placeDeclined).not.toHaveBeenCalled();
  });

  it('replies placeDeclined, and changes nothing, when this window does not hold the parent', () => {
    const before = twoTabs();
    const ws = fakeWs(before);
    const bridge = fakeBridge({ kind: 'placedElsewhere' });

    expect(handlePreviewPlace(ws, bridge, { ...place, besidePanelId: 'not-here' })).toBe(false);

    expect(bridge.placeDeclined).toHaveBeenCalledWith('req-1');
    expect(ws.layout).toBe(before);
    expect(ws.calls).toEqual([]);
  });

  /*
   * Review of batch B, M-1 — when every window that might hold the parent declined, main asks the REQUESTING
   * window to place it standalone (`besidePanelId: null`) rather than leave Open Preview doing nothing. It
   * lands where a standalone preview does (FR-011); parenting is derived in main (FR-013).
   */
  it('a place beside NOTHING (main’s fallback) lands standalone in the active tab, with the reservation', () => {
    const ws = fakeWs(twoTabs());
    const bridge = fakeBridge({ kind: 'placedElsewhere' });
    watchFocus('new-1');

    expect(handlePreviewPlace(ws, bridge, { ...place, besidePanelId: null })).toBe(true);

    const l = ws.layout as WorkspaceLayout;
    expect(collectPanels(l.tabs[0]!.root).map((p) => p.id)).toEqual(['front', 'new-1']);
    expect(allPanels(l).find((p) => p.id === 'new-1')).toMatchObject({ kind: PREVIEW_KIND, config: { filePath: FILE } });
    expect(ws.calls).not.toContain('addPanelBeside');
    expect(focused).toEqual(['new-1']);
    expect(previewReservationFor('new-1')).toBe('r-9');
    expect(bridge.placeDeclined).not.toHaveBeenCalled();
  });
});

/* ── focus (main → this window) ──────────────────────────────────────────────────────────────── */

describe('an incoming focus (FR-014, FR-090c)', () => {
  function layoutWithPreview(): WorkspaceLayout {
    const l = twoTabs();
    return {
      ...l,
      tabs: [l.tabs[0]!, { id: 't2', title: 'Tab 2', root: panel('pv', { kind: PREVIEW_KIND, config: { filePath: FILE } }) }],
    };
  }

  /** A rendered preview body: the scroll container and three headings, with rects jsdom cannot give. */
  function renderedBody(): HTMLElement {
    const body = document.createElement('div');
    body.setAttribute('data-testid', 'preview-body-pv');
    const tops: Record<string, number> = { intro: 40, usage: 640, faq: 1240 };
    for (const slug of Object.keys(tops)) {
      const h = document.createElement('h2');
      h.setAttribute('data-heading-slug', slug);
      h.getBoundingClientRect = () => ({ top: tops[slug]! - body.scrollTop, height: 30 }) as DOMRect;
      body.append(h);
    }
    body.getBoundingClientRect = () => ({ top: 40, height: 400 }) as DOMRect;
    document.body.append(body);
    return body;
  }

  it('brings the preview’s tab to the front and focuses it', () => {
    const ws = fakeWs(layoutWithPreview());
    watchFocus('pv');
    expect(handlePreviewFocus(ws, { panelId: 'pv' })).toBe(true);
    expect((ws.layout as WorkspaceLayout).activeTabId).toBe('t2');
    expect(focused).toEqual(['pv']);
  });

  it('with a fragment, also scrolls that preview’s body to the heading whose data-heading-slug matches', () => {
    const ws = fakeWs(layoutWithPreview());
    const body = renderedBody();

    handlePreviewFocus(ws, { panelId: 'pv', fragment: 'usage' });

    // The heading's top (640) comes to the body's top (40).
    expect(body.scrollTop).toBe(600);
  });

  it('hands the fragment to a MOUNTED preview panel, which owns the scroll and the missing-heading notice (044 US6)', () => {
    const ws = fakeWs(layoutWithPreview());
    const body = renderedBody();
    const asked: string[] = [];
    const unregister = registerPreviewPanelHandles('pv', {
      followFocusedLink: () => false,
      revealFragment: (fragment) => void asked.push(fragment),
    });
    try {
      handlePreviewFocus(ws, { panelId: 'pv', fragment: 'usage' });
    } finally {
      unregister();
    }
    expect(asked).toEqual(['usage']);
    // The panel scrolls, not the fallback: nothing moved the raw body.
    expect(body.scrollTop).toBe(0);
  });

  it('does nothing for a panel this window does not hold', () => {
    const before = layoutWithPreview();
    const ws = fakeWs(before);
    expect(handlePreviewFocus(ws, { panelId: 'somewhere-else' })).toBe(false);
    expect(ws.layout).toBe(before);
    expect(ws.calls).toEqual([]);
  });
});
