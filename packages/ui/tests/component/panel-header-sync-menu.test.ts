/**
 * 044 T234 — Synchronise Scrolling in the editor's and the preview's HEADER menus, and the editor's
 * surfaces mounted end to end (FR-122, FR-122a, FR-122b; contracts/menus-and-controls.md §1, §2, §10).
 *
 * ══ WHAT IS PINNED ══
 *
 * The builder's conditions — the label with its ✓ while on, the test id pinned to the bare label, the
 * `syncScroll` icon, the live `preview.toggleSyncScroll` chord or none, ABSENT exactly where Open Preview is
 * absent, PRESENT AND ENABLED while Open Preview is disabled for either reason, and one call of the toggle —
 * and then the wiring nothing but a mounted panel can show: `panel-placeholder.tsx` decides presence from the
 * editor's affordance or the preview's provider kind and on/off from the settings, and every surface reaches
 * the one key-scoped write.
 *
 * ══ THE TWO ANALYZE FINDINGS ══
 *
 * G1 — the menu items are the canonical route (Principle VI), so they survive a hidden status bar. G2 — the
 * status-bar button is hidden with the whole bar, and only then (040 FR-033).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  PREVIEW_KIND,
  SHIPPED_PREVIEW_PROVIDERS,
  previewAffordance,
  type Keybindings,
  type Panel,
  type PreviewAffordance,
  type PreviewSettings,
} from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
  type PanelHeaderMenuArgs,
} from '../../src/renderer/workspace/panel-header-menu.js';
import { mountEditor } from './helpers/mount-editor.js';
import { COLD, mountMarkdownPreview } from './helpers/mount-preview-panel.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPreviewOpenStore } from '../../src/renderer/preview/preview-open-store.js';

const SYNC = 'menu-item-Synchronise Scrolling';
const PATCH = [{ path: ['editor', 'previews', 'syncScroll'], value: false }];
const noop = (): void => {};

/** Every action a no-op except the toggle under test. */
const actions = (toggleSyncScroll: () => void = noop): PanelHeaderMenuActions =>
  new Proxy({} as PanelHeaderMenuActions, {
    get: (_target, key) => (key === 'toggleSyncScroll' ? toggleSyncScroll : noop),
  });

const panel = (over: Partial<Panel>): Panel => ({ type: 'panel', id: 'p1', originProjectId: 'proj', title: 'README.md', ...over });

const affordance = (over: { path?: string; enabled?: boolean; previewOpen?: boolean } = {}): PreviewAffordance => {
  const settings: PreviewSettings = structuredClone(DEFAULT_APP_SETTINGS.editor.previews);
  if (over.enabled === false) settings.providers.markdown = { ...settings.providers.markdown, enabled: false };
  return previewAffordance({
    registry: SHIPPED_PREVIEW_PROVIDERS,
    settings,
    absPath: over.path ?? 'D:/proj/README.md',
    projectRoot: 'D:/proj',
    isFolder: false,
    previewOpen: over.previewOpen ?? false,
    surface: 'editor',
  });
};

function header(over: Partial<PanelHeaderMenuArgs> & { panel: Panel }): MenuAction[] {
  return panelHeaderMenu({
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: null,
    panelFailure: false,
    detach: null,
    actions: actions(),
    ...over,
  });
}

const editorHeader = (over: Partial<PanelHeaderMenuArgs> = {}): MenuAction[] =>
  header({
    panel: panel({ kind: 'editor' }),
    editor: { dirty: false, hasFilePath: true },
    openPreview: affordance(),
    syncScroll: true,
    ...over,
  });

const previewHeader = (over: Partial<PanelHeaderMenuArgs> = {}): MenuAction[] =>
  header({
    panel: panel({ kind: PREVIEW_KIND, config: { filePath: 'D:/proj/README.md' } }),
    preview: { providerKind: 'text', parented: false },
    syncScroll: true,
    ...over,
  });

const sync = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.testId === SYNC);

const bound: Keybindings = {
  ...DEFAULT_KEYBINDINGS,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'preview.toggleSyncScroll': ['Ctrl+Alt+F8'] },
};

describe.each([
  ['the editor header', editorHeader],
  ['the preview header', previewHeader],
] as const)('%s — Synchronise Scrolling (FR-122b)', (_name, build) => {
  it('reads “Synchronise Scrolling ✓” while on and the bare label while off, under one test id', () => {
    expect(sync(build({ syncScroll: true }))?.label).toBe('Synchronise Scrolling ✓');
    expect(sync(build({ syncScroll: false }))?.label).toBe('Synchronise Scrolling');
  });

  it('sits in View & state with the syncScroll icon, directly after Zoom as drawn', () => {
    const items = build();
    expect(sync(items)).toMatchObject({ section: 'viewState', icon: 'syncScroll' });
    const drawn = withDividers(items).map((i) => ('section' in i ? (i.testId ?? i.label) : '—'));
    expect(drawn[drawn.indexOf(SYNC) - 1]).toBe('Zoom');
  });

  it('shows the chord when preview.toggleSyncScroll is bound, and none when it ships unbound', () => {
    expect(sync(build({ keybindings: bound }))?.shortcut).toBe('Ctrl+Alt+F8');
    expect(sync(build())?.shortcut).toBeUndefined();
  });

  it('comes before the failure-banner items', () => {
    const labels = build({ panelFailure: true }).map((i) => i.testId ?? i.label);
    expect(labels.indexOf(SYNC)).toBeLessThan(labels.indexOf('Try again'));
  });

  it('runs the toggle once when chosen', () => {
    const toggle = vi.fn();
    sync(build({ actions: actions(toggle) }))?.onClick?.();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('where it is offered on the editor header (FR-122a)', () => {
  it('is ABSENT wherever Open Preview is absent', () => {
    expect(sync(editorHeader({ openPreview: affordance({ path: 'D:/proj/a.ts' }) }))).toBeUndefined();
    expect(sync(editorHeader({ openPreview: affordance({ path: 'E:/elsewhere/README.md' }) }))).toBeUndefined();
    expect(sync(editorHeader({ openPreview: undefined }))).toBeUndefined();
  });

  it('is PRESENT and ENABLED while Open Preview is disabled for either reason', () => {
    for (const a of [affordance({ enabled: false }), affordance({ previewOpen: true })]) {
      expect(a.state).toBe('disabled');
      const item = sync(editorHeader({ openPreview: a }));
      expect(item).toBeDefined();
      expect(item?.disabled ?? false).toBe(false);
    }
  });
});

describe('where it is offered on the preview header (FR-122a)', () => {
  it('on every text-provider preview, standalone or parented', () => {
    expect(sync(previewHeader({ preview: { providerKind: 'text', parented: false } }))).toBeDefined();
    expect(sync(previewHeader({ preview: { providerKind: 'text', parented: true } }))).toBeDefined();
  });

  it('never on a binary provider’s preview', () => {
    expect(sync(previewHeader({ preview: { providerKind: 'binary', parented: false } }))).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounted: the call sites
 * ────────────────────────────────────────────────────────────────────────── */

const PANEL = 'p-ed';
const ROOT = 'C:/proj';

/** `writeConfigPatch` reads `window.throng.config.writePatch` per call, so a spy set after mount is seen. */
function spyPatches(result: { ok: boolean } = { ok: true }) {
  const writePatch = vi.fn((_id: unknown, _changes: unknown) => Promise.resolve(result));
  (window.throng as unknown as { config: Record<string, unknown> }).config.writePatch = writePatch;
  return writePatch;
}

async function mountEditorPanel(opts: { file?: string; settings?: Record<string, unknown> } = {}) {
  const fake = {
    open: vi.fn(() => Promise.resolve({ kind: 'focused' as const, panelId: null })),
    placeDeclined: vi.fn(),
    publishEditorTitle: vi.fn(),
    openPaths: vi.fn(() => Promise.resolve([] as string[])),
    onPlace: vi.fn(() => noop),
    onFocus: vi.fn(() => noop),
    onOpenChanged: vi.fn(() => noop),
    destroyed: vi.fn(),
  };
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: '# Hello\n', version: 1, absPath: opts.file ?? `${ROOT}/README.md` },
    projectRoot: ROOT,
    withHeader: true,
    withChrome: true,
    registerProject: true,
    ...(opts.settings ? { settings: opts.settings } : {}),
    throng: { preview: fake },
  });
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

beforeEach(() => {
  __resetPreviewOpenStore();
  setActivePane('workspace');
});
afterEach(() => {
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

describe('a mounted editor (panel-placeholder.tsx, use-editor.ts)', () => {
  it('the header item is checked from the settings and writes the one key once', async () => {
    await mountEditorPanel();
    await screen.findByTestId(`editor-sync-scroll-${PANEL}`, {}, COLD);
    const writePatch = spyPatches();
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`), { clientX: 10, clientY: 10 });
    const item = await screen.findByTestId(SYNC);
    expect(item).toHaveTextContent('Synchronise Scrolling ✓');
    fireEvent.click(item);
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch.mock.calls[0]?.[1]).toEqual(PATCH);
  });

  it('the body item is checked from the settings and writes the one key once', async () => {
    const h = await mountEditorPanel();
    await screen.findByTestId(`editor-sync-scroll-${PANEL}`, {}, COLD);
    const writePatch = spyPatches();
    fireEvent.contextMenu(h.content(), { clientX: 10, clientY: 10 });
    const item = await screen.findByTestId(SYNC);
    expect(item).toHaveTextContent('Synchronise Scrolling ✓');
    fireEvent.click(item);
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch.mock.calls[0]?.[1]).toEqual(PATCH);
  });

  it('offers neither item on an editor whose file no provider claims', async () => {
    const h = await mountEditorPanel({ file: `${ROOT}/notes.txt` });
    await screen.findByTestId(`editor-word-wrap-${PANEL}`, {}, COLD);
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`), { clientX: 10, clientY: 10 });
    await screen.findByTestId('menu-item-Send to Tab');
    expect(screen.queryByTestId(SYNC)).toBeNull();
    fireEvent.contextMenu(h.content(), { clientX: 10, clientY: 10 });
    await screen.findByTestId('menu-item-Word Wrap');
    expect(screen.queryByTestId(SYNC)).toBeNull();
  });

  it('G1 — with the status bar hidden, both menu items are still offered, enabled', async () => {
    const h = await mountEditorPanel({ settings: { editor: { showStatusBar: false } } });
    expect(screen.queryByTestId(`editor-status-strip-${PANEL}`)).toBeNull();
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`), { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByTestId(SYNC)).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.contextMenu(h.content(), { clientX: 10, clientY: 10 });
    await screen.findByTestId('menu-item-Word Wrap');
    expect(screen.getByTestId(SYNC)).toHaveAttribute('aria-disabled', 'false');
  });

  it('G2 — the status-bar button goes with the whole bar, and only with it', async () => {
    const h = await mountEditorPanel();
    await screen.findByTestId(`editor-sync-scroll-${PANEL}`, {}, COLD);
    h.pushSettings({ editor: { showStatusBar: false } });
    await waitFor(() => expect(screen.queryByTestId(`editor-status-strip-${PANEL}`)).toBeNull());
    expect(screen.queryByTestId(`editor-sync-scroll-${PANEL}`)).toBeNull();
    h.pushSettings({ editor: { showStatusBar: true } });
    await screen.findByTestId(`editor-sync-scroll-${PANEL}`, {}, COLD);
  });
});

describe('a mounted preview (panel-placeholder.tsx)', () => {
  it('the header item is checked from the settings and writes the one key once', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      const writePatch = spyPatches();
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${m.id}`), { clientX: 10, clientY: 10 });
      const item = await screen.findByTestId(SYNC);
      expect(item).toHaveTextContent('Synchronise Scrolling ✓');
      fireEvent.click(item);
      await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
      expect(writePatch.mock.calls[0]?.[1]).toEqual(PATCH);
    } finally {
      m.unmount();
    }
  });

  it('G1 — with the status bar hidden the header item is still offered', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n', undefined, { settings: { editor: { showStatusBar: false } } });
    try {
      await screen.findByText('words', {}, COLD);
      expect(screen.queryByTestId(`preview-status-bar-${m.id}`)).toBeNull();
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${m.id}`), { clientX: 10, clientY: 10 });
      expect(await screen.findByTestId(SYNC)).toHaveAttribute('aria-disabled', 'false');
    } finally {
      m.unmount();
    }
  });
});
