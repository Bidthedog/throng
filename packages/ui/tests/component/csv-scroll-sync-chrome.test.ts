/**
 * 073 FR-033c — a CSV takes part in Synchronise Scrolling with its text editor though it is not a flowing document: the
 * toggle and menu rows are drawn where a provider with `scrollSync` is, and Go to Heading stays absent. The provider's
 * own capability decides it (`supportsScrollSync`), so the chrome names no provider.
 *
 * Layer: component — what each surface draws for a provider that has the capability and one that does not. The mapping
 * itself is `csv-record-lines.test.ts`'s (core) and the body's following is `csv-body-scroll-sync.test.ts`'s.
 */
import { act, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetSyncMarks, publishSyncMark } from '../../src/renderer/preview/sync-mark-store.js';
import { previewUpdate } from './helpers/mount-preview-panel.js';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, createPreviewProviderRegistry, type Panel } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const registry = createPreviewProviderRegistry([
  { id: 'gridSync', displayName: 'Grid', extensions: ['.prvsync'], kind: 'text', flowingDocument: false, scrollSync: true },
  { id: 'picture', displayName: 'Picture', extensions: ['.prvpic'], kind: 'text', flowingDocument: false },
  { id: 'flow', displayName: 'Flow', extensions: ['.prvflow'], kind: 'text' },
]);
function FakeBody({ panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}
const views: Record<string, PreviewProviderView> = Object.fromEntries(
  ['gridSync', 'picture', 'flow'].map((id) => [id, { id, textSelection: true, load: () => Promise.resolve(FakeBody) }]),
);

let m: MountedPreviewWindow | undefined;
afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

async function mount(id: string, file: string): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview('a,b\n', file, { providers: { registry, views }, providerId: id });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

describe('the preview status bar (FR-033c)', () => {
  it('draws the Synchronise Scrolling toggle for a provider with scrollSync, though it is not a flowing document', async () => {
    const win = await mount('gridSync', 'D:/proj/t.prvsync');
    expect(screen.getByTestId(`preview-sync-scroll-${win.id}`)).toBeTruthy();
  });

  it('still draws none for a one-picture provider, and one for a flowing document', async () => {
    const picture = await mount('picture', 'D:/proj/t.prvpic');
    expect(screen.queryByTestId(`preview-sync-scroll-${picture.id}`)).toBeNull();
    picture.unmount();
    document.body.replaceChildren();
    const flow = await mount('flow', 'D:/proj/t.prvflow');
    expect(screen.getByTestId(`preview-sync-scroll-${flow.id}`)).toBeTruthy();
  });
});

describe('the panel header menu (FR-033c)', () => {
  const panel = (): Panel => ({
    type: 'panel',
    id: 'p1',
    originProjectId: 'proj',
    title: 't',
    kind: PREVIEW_KIND,
    config: { filePath: 'D:/proj/t.prvsync' },
  });
  const actions = new Proxy({} as PanelHeaderMenuActions, { get: () => () => {} });
  const labels = (preview: Record<string, unknown>): string[] =>
    panelHeaderMenu({
      panel: panel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      actions,
      preview: { providerKind: 'text', parented: true, ...preview },
    } as never)
      .map((i) => ('label' in i ? (i.label ?? '') : ''))
      .filter(Boolean);

  it('offers Synchronise Scrolling when the provider scrolls in step, whatever flowingDocument says', () => {
    expect(labels({ flowingDocument: false, scrollSync: true })).toContain('Synchronise Scrolling');
  });

  it('offers none for a provider that does not, and keeps the flowing-document default when scrollSync is absent', () => {
    expect(labels({ flowingDocument: false })).not.toContain('Synchronise Scrolling');
    expect(labels({ flowingDocument: false, scrollSync: false })).not.toContain('Synchronise Scrolling');
    expect(labels({ flowingDocument: true })).toContain('Synchronise Scrolling');
  });
});

describe('a sync mark that moves re-renders the body that draws it, not the panel chrome (073 T075)', () => {
  it('hands the body a live source instead of the mark\'s value, so a mark move renders nothing above the body', async () => {
    __resetSyncMarks();
    const parent = { panelId: 'ed-1', title: 'data.prvsync' };
    let renders = 0;
    let source: PreviewBodyProps['syncMarkSource'] = null;
    function CountingBody(props: PreviewBodyProps): ReactElement {
      renders += 1;
      source = props.syncMarkSource;
      return createElement('div', { 'data-testid': `fake-body-${props.panelId}` }, 'body');
    }
    const counting: Record<string, PreviewProviderView> = {
      gridSync: { id: 'gridSync', textSelection: true, load: () => Promise.resolve(CountingBody) },
    };
    m = await mountMarkdownPreview('a,b\n', 'D:/proj/t.prvsync', {
      providers: { registry, views: counting },
      providerId: 'gridSync',
      attach: { parent },
    });
    await screen.findByTestId(`fake-body-${m.id}`);
    m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent }));
    await act(() => Promise.resolve());
    expect(source).not.toBeNull();
    const before = renders;

    for (let line = 1; line <= 20; line += 1) act(() => publishSyncMark('ed-1', line));

    expect(renders).toBe(before); // twenty mark moves, no body re-render from the chrome
    expect(source!.get()).toEqual({ line: 20, on: true }); // yet the source is live
    __resetSyncMarks();
  });
});
