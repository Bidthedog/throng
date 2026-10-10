/**
 * 054 T011 — a preview restored with its layout is reused by Last Active, exactly as if the user had
 * focused it (FR-001 – FR-003, research R1, issue #474).
 *
 * Layer: component — the whole window: the workspace store's load effect seeds each tab's recency from the
 * restored layout, and the registered `preview.open` command reads it. The layout is main's restore answer;
 * `preview.open` is main's mock, so what is asserted is the `reusePanelId` the window asks main to reuse.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PREVIEW_KIND, createDefaultLayout, type Panel, type Tab, type WorkspaceLayout } from '@throng/core';
import { requestPreviewOpen } from '../../src/renderer/preview/open-preview.js';
import { __resetLastActivePreview } from '../../src/renderer/preview/last-active-preview.js';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const preview = (id: string, file: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind: PREVIEW_KIND,
  config: { filePath: `${ROOT}/${file}` },
});
const plain = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

function restored(first: Omit<Tab, 'id' | 'title'>, second?: Omit<Tab, 'id' | 'title'>): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' });
  return {
    ...base,
    tabs: [{ id: 't1', title: 'One', ...first }, ...(second ? [{ id: 't2', title: 'Two', ...second }] : [])],
    activeTabId: 't1',
  };
}

const split = (...children: Panel[]): Tab['root'] => ({
  type: 'split',
  orientation: 'row',
  sizes: children.map(() => 1 / children.length),
  children,
});

let pv: MountedPreviewWindow | undefined;
afterEach(() => {
  pv?.unmount();
  pv = undefined;
  __resetLastActivePreview();
  document.body.replaceChildren();
});

async function mount(layout: WorkspaceLayout): Promise<MountedPreviewWindow> {
  pv = await mountMarkdownPreview('# Restored\n', undefined, { layout });
  await screen.findAllByText('Restored', {}, COLD);
  pv.preview.open.mockResolvedValue({ kind: 'placedElsewhere' });
  return pv;
}

async function openAnother(target?: { mode: 'lastActive' | 'new' }): Promise<{ mode: string; reusePanelId: string | null }> {
  await act(() => requestPreviewOpen({ absPath: `${ROOT}/docs/next.md`, projectId: PROJECT, ...(target ? { target } : {}) }));
  const calls = pv!.preview.open.mock.calls;
  return (calls.at(-1)![0] as { target: { mode: string; reusePanelId: string | null } }).target;
}

describe('a restored layout and Last Active (FR-001)', () => {
  it('one restored preview, never focused this session, is the one reused', async () => {
    await mount(restored({ root: split(plain('term'), preview('pv1', 'README.md')) }));
    expect(await openAnother()).toEqual({ mode: 'lastActive', reusePanelId: 'pv1' });
  });

  it('with two restored previews, the persisted most recent wins (FR-002)', async () => {
    await mount(restored({ root: split(preview('pv1', 'README.md'), preview('pv2', 'b.md')), previewRecency: ['pv2', 'pv1'] }));
    expect(await openAnother()).toEqual({ mode: 'lastActive', reusePanelId: 'pv2' });
  });

  it('New Preview Panel is unaffected: it never names a panel to reuse', async () => {
    await mount(restored({ root: split(plain('term'), preview('pv1', 'README.md')) }));
    expect(await openAnother({ mode: 'new' })).toEqual({ mode: 'new', reusePanelId: null });
  });

  it('a restored preview in a BACKGROUND tab is never reused', async () => {
    await mount(restored({ root: split(plain('term'), preview('pv1', 'README.md')) }, { root: preview('bg', 'c.md') }));
    const target = await openAnother();
    expect(target.reusePanelId).not.toBe('bg');
    expect(target.reusePanelId).toBe('pv1');
  });
});
