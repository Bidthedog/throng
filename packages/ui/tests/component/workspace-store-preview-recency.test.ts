/**
 * 054 FR-001, FR-002 (research R1) — the workspace store's side of preview recency: `setPreviewRecency`
 * writes a tab's most-recent-first preview ids onto the layout through the ordinary debounced save, and
 * an unchanged order writes nothing.
 *
 * Layer: component — the op lives in the React provider (`WorkspaceProvider`), and the observable is the
 * `workspace.save` the store sends. The recency list itself is `unit/last-active-preview.test.ts`; the
 * fallback for a layout saved without one is core's `preview-recency.test.ts`.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, PREVIEW_KIND, type Panel, type WorkspaceLayout } from '@throng/core';
import {
  __resetLastActivePreview,
  candidateFor,
  recordLastActivePreview,
} from '../../src/renderer/preview/last-active-preview.js';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';

const PROJECT = 'proj-recency';
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [blank('p1'), blank('p2')] };
  return l;
}

let m: MountedTabGroup | undefined;

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });
}

afterEach(() => {
  m?.unmount();
  m = undefined;
});

/** t1 (shown) holds a blank panel; t2 (never mounted) holds two Markdown previews. */
function withPreviews(previewRecency?: string[]): WorkspaceLayout {
  const l = layout();
  const preview = (id: string): Panel => ({
    ...blank(id),
    kind: PREVIEW_KIND,
    config: { filePath: `D:/proj/${id}.md` },
  });
  l.tabs.push({
    id: 't2',
    title: 'Docs',
    root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [preview('v1'), preview('v2')] },
    activePanelId: 'v1',
    ...(previewRecency ? { previewRecency } : {}),
  });
  return l;
}

describe('the load seeds Last Active from every tab (054 FR-001, FR-002)', () => {
  afterEach(() => __resetLastActivePreview());

  it('takes the persisted order, in a tab never shown', async () => {
    m = mountTabGroup(withPreviews(['v2', 'v1']));
    await screen.findByTestId('panel-p1');
    expect(candidateFor('t2', () => true)).toBe('v2');
  });

  it('falls back to the tab’s focused preview for a layout saved before 054', async () => {
    m = mountTabGroup(withPreviews());
    await screen.findByTestId('panel-p1');
    expect(candidateFor('t2', () => true)).toBe('v1');
  });

  it('writes a changed order back to the layout through setPreviewRecency', async () => {
    m = mountTabGroup(withPreviews(['v1', 'v2']));
    await screen.findByTestId('panel-p1');
    act(() => recordLastActivePreview('t2', 'v2'));
    expect(m.ws().layout!.tabs[1]!.previewRecency).toEqual(['v2', 'v1']);
  });
});

describe('setPreviewRecency (054 FR-002)', () => {
  it('records the order on the tab and saves it with the layout', async () => {
    m = mountTabGroup(layout());
    await screen.findByTestId('panel-p1');
    await settle(500);
    const before = m.saves.mock.calls.length;
    act(() => m!.ws().setPreviewRecency('t1', ['p2', 'p1']));
    expect(m.ws().layout!.tabs[0]!.previewRecency).toEqual(['p2', 'p1']);
    await settle(500);
    expect(m.saves.mock.calls.length).toBe(before + 1);
    const saved = m.saves.mock.calls.at(-1)![0] as { layout: WorkspaceLayout };
    expect(JSON.stringify(saved)).toContain('"previewRecency":["p2","p1"]');
  });

  it('writes nothing when the order is unchanged, or the tab is unknown', async () => {
    m = mountTabGroup(layout());
    await screen.findByTestId('panel-p1');
    act(() => m!.ws().setPreviewRecency('t1', ['p2']));
    await settle(500);
    const before = m.saves.mock.calls.length;
    const held = m.ws().layout;
    act(() => m!.ws().setPreviewRecency('t1', ['p2']));
    act(() => m!.ws().setPreviewRecency('nope', ['p1']));
    await settle(500);
    expect(m.saves.mock.calls.length).toBe(before);
    expect(m.ws().layout).toBe(held);
  });
});
