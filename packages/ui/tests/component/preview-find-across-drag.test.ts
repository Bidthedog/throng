/**
 * 049 T054 — a PREVIEW with find at `2 of 5` keeps `2 of 5`, its highlights and Next after a real drag: to a new
 * position in the SAME tab (which already worked) and into ANOTHER tab (FR-000, FR-001, FR-002).
 *
 * The maintainer saw the bar read "No results" after the cross-tab drag, with the word in the preview. The drag is
 * a real dnd-kit drag through `TabGroup`; what is read is what a user reads — the count the bar holds, and the
 * ranges registered under the Custom Highlight names (the fake `CSS.highlights` below stands in for the browser's).
 */
import { act, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  SHIPPED_PREVIEW_PROVIDERS,
  addTab,
  createDefaultLayout,
  splitPanel,
  type PreviewAttachRequest,
  type WorkspaceLayout,
} from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { dragPanelTo, installDropGeometry } from './helpers/drop-panel.js';
import { COLD, previewUpdate } from './helpers/mount-preview-panel.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { PREVIEW_PROVIDER_VIEWS } from '../../src/renderer/preview/providers/index.js';
import { __resetPreviewOpenStore } from '../../src/renderer/preview/preview-open-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { __resetSplitMode } from '../../src/renderer/workspace/split-mode.js';
import { __resetFindState, findNext, getFindSession, openFind, setTerm } from '../../src/renderer/search/search-store.js';
import { PREVIEW_CURRENT_MATCH_HIGHLIGHT, PREVIEW_MATCH_HIGHLIGHT } from '../../src/renderer/preview/preview-search.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const FIVE = '# Title\n\nfoo 1\n\nfoo 2\n\nfoo 3\n\nfoo 4\n\nfoo 5\n';
const FILE = 'D:/proj/README.md';

let registry: Map<string, FakeHighlight>;
let mounted: MountedTabGroup | null = null;
let uninstall: () => void = () => {};

beforeEach(() => {
  registry = new Map();
  Reflect.set(globalThis, 'CSS', { highlights: registry });
  Reflect.set(globalThis, 'Highlight', FakeHighlight);
  uninstall = installDropGeometry();
  __resetPreviewStore();
  __resetPreviewOpenStore();
});
afterEach(() => {
  uninstall();
  mounted?.unmount();
  mounted = null;
  __resetFindState();
  __resetSplitMode();
  __resetPanelFocus();
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(globalThis, 'Highlight');
});

/** main's preview bridge, answering `attach` with the document and everything else with a quiet default. */
function previewBridge(): Record<string, unknown> {
  const none = (): (() => void) => () => {};
  return {
    preview: {
      attach: vi.fn((req: PreviewAttachRequest) =>
        Promise.resolve({
          ok: true as const,
          update: previewUpdate({
            panelId: req.panelId,
            filePath: req.filePath,
            providerId: 'markdown',
            content: { kind: 'text', text: FIVE },
            revision: 1,
          }),
        }),
      ),
      onUpdate: vi.fn(none),
      onOpenChanged: vi.fn(none),
      onPathChanged: vi.fn(none),
      onPlace: vi.fn(none),
      onFocus: vi.fn(none),
      openPaths: vi.fn(() => Promise.resolve([] as string[])),
      refresh: vi.fn(() => Promise.resolve({ update: null })),
      detach: vi.fn(),
      destroyed: vi.fn(),
      placeDeclined: vi.fn(),
    },
    links: {},
    clipboard: { write: vi.fn(), writeRich: vi.fn(), paste: vi.fn() },
    editor: { openInto: vi.fn(() => Promise.resolve({ action: 'open' })) },
    files: { revealDocument: vi.fn() },
  };
}

/** t1 holds the preview `pv` beside an untyped `p2`; t2 holds `p3`. */
function layout(): WorkspaceLayout {
  const base = createDefaultLayout('proj-find-drag', { tab: 't1', panel: 'pv' });
  const split = splitPanel(base, 't1', 'pv', 'right', { id: 'p2', title: 'Panel 2' });
  const two = addTab(split, { tab: 't2', panel: 'p3' });
  return {
    ...two,
    activeTabId: 't1',
    tabs: two.tabs.map((t) => ({
      ...t,
      root: JSON.parse(
        JSON.stringify(t.root).replace('"id":"pv"', `"id":"pv","kind":"${PREVIEW_KIND}","config":{"filePath":"${FILE}"}`),
      ),
    })),
  };
}

const matchRanges = (): Range[] => registry.get(PREVIEW_MATCH_HIGHLIGHT)?.ranges ?? [];
const currentRange = (): Range | undefined => registry.get(PREVIEW_CURRENT_MATCH_HIGHLIGHT)?.ranges[0];
const paragraphOf = (r: Range | undefined): string | null | undefined => r?.startContainer.parentElement?.textContent;

async function mountWithFindAtTwoOfFive(): Promise<void> {
  mounted = mountTabGroup(layout(), {
    throng: previewBridge(),
    wrap: (children) =>
      createElement(
        PreviewProviderRegistryContext.Provider,
        { value: { registry: SHIPPED_PREVIEW_PROVIDERS, views: PREVIEW_PROVIDER_VIEWS } },
        children,
      ),
  });
  await screen.findByTestId('preview-markdown-pv', {}, COLD);
  await screen.findByRole('heading', { name: 'Title' }, COLD);
  act(() => {
    openFind('pv', 'preview');
    setTerm('pv', 'foo');
    findNext('pv');
  });
  expect(getFindSession('pv')?.count).toEqual({ current: 2, total: 5 });
  expect(matchRanges()).toHaveLength(5);
}

async function expectFindKept(): Promise<void> {
  await screen.findByTestId('preview-markdown-pv', {}, COLD);
  await screen.findByRole('heading', { name: 'Title' }, COLD);
  await waitFor(() => expect(matchRanges()).toHaveLength(5), COLD);
  expect(getFindSession('pv')?.count).toEqual({ current: 2, total: 5 });
  expect(paragraphOf(currentRange())).toBe('foo 2');
  act(() => findNext('pv'));
  expect(getFindSession('pv')?.count).toEqual({ current: 3, total: 5 });
  expect(paragraphOf(currentRange())).toBe('foo 3');
}

describe('a preview with an open find, dragged (FR-000)', () => {
  it('to another position in the same tab keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'pv', 'edge-right-p2');
    await expectFindKept();
  });

  it('into another tab keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'pv', 'tab-t2');
    expect(mounted!.ws().layout!.activeTabId).toBe('t2');
    await expectFindKept();
  });

  it('into another tab, after lingering over its chip until the tab switched mid-drag, keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'pv', 'tab-t2', 700);
    expect(mounted!.ws().layout!.activeTabId).toBe('t2');
    await expectFindKept();
  });
});
