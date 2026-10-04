/**
 * A preview whose file a move took out of its project (050 FR-035, SC-012; research R18, R19).
 *
 * The panel stays, shows ONE moved notice (Close and Copy, no Retry), reads nothing and covers its body.
 * Three doors lead there: the run's `moved-out` notice on an update, a persisted `movedOut` in the
 * panel's config (a project shown later, or after a restart) — which must not attach at all — and, for
 * the held layout, `PreviewPathSync` copying the flag into the config so the second door is true.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREVIEW_KIND, collectPanels, type Panel } from '@throng/core';
import { runPreviewEditorRoute } from '../../src/renderer/preview/open-in-editor.js';
import { previewContentMenu } from '../../src/renderer/preview/content-menu.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { PreviewPathSync } from '../../src/renderer/preview/preview-path-sync.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const NEW = 'E:/other/README.md';
const SENTENCE = `This file moved to another project, at ${NEW}. You can no longer work on it in this project.`;

let m: MountedPreviewWindow | undefined;
const banners = (): HTMLElement[] => screen.queryAllByTestId(`panel-failure-${m!.id}`);
const banner = (): HTMLElement => screen.getByTestId(`panel-failure-${m!.id}`);
/** The persisted shape of the panel's config: what the layout blob would carry (`undefined` drops out). */
const config = (): Record<string, unknown> | undefined =>
  JSON.parse(JSON.stringify(m!.ws().layout)).tabs[0].root.config as Record<string, unknown> | undefined;

beforeEach(() => {
  __resetPreviewStore();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('a preview in the moved-out state (FR-035)', () => {
  it('shows the moved notice once, with Close and Copy and no Retry, and no failure banner', async () => {
    m = await mountMarkdownPreview('# Readme\n\nReadme body.\n');
    await screen.findByText('Readme body.', {}, COLD);

    m.push(previewUpdate({ panelId: m.id, revision: 2, filePath: NEW, notice: { kind: 'moved-out', movedTo: NEW } }));

    expect(banners()).toHaveLength(1);
    const b = banner();
    expect((b.textContent ?? '').replace(/\\/g, '/')).toContain(SENTENCE);
    expect(within(b).getByTitle('Close')).toBeInTheDocument();
    expect(within(b).getByTitle('Copy details')).toBeInTheDocument();
    expect(within(b).queryByTitle('Try again')).toBeNull();
    expect(within(b).queryByTitle('Clear panel type')).toBeNull();
    expect(b).not.toHaveTextContent(/could not be read|no longer exists/i);
  });

  it('becomes an ordinary preview again when the run comes back with no notice (undo)', async () => {
    m = await mountMarkdownPreview('# Readme\n\nReadme body.\n');
    await screen.findByText('Readme body.', {}, COLD);
    m.push(previewUpdate({ panelId: m.id, revision: 2, filePath: NEW, notice: { kind: 'moved-out', movedTo: NEW } }));
    expect(banners()).toHaveLength(1);

    m.push(previewUpdate({ panelId: m.id, revision: 3, filePath: README, notice: null }));

    await waitFor(() => expect(banners()).toHaveLength(0));
  });
});

describe('mounted with movedOut in its config (R19)', () => {
  it('shows the notice without attaching, and raises no could-not-read notice', async () => {
    m = await mountMarkdownPreview('# unused\n', NEW, { config: { movedOut: true } });

    await waitFor(() => expect(banners()).toHaveLength(1));
    expect((banner().textContent ?? '').replace(/\\/g, '/')).toContain(SENTENCE);
    expect(m.preview.attach, 'the file is not read').not.toHaveBeenCalled();
    expect(within(banner()).queryByTitle('Try again')).toBeNull();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });

  it('attaches once the flag goes (an undo brought the file back)', async () => {
    m = await mountMarkdownPreview('# Readme\n\nBack again.\n', NEW, {
      config: { movedOut: true },
      extras: [createElement(PreviewPathSync, { key: 'sync' })],
    });
    await waitFor(() => expect(banners()).toHaveLength(1));

    m.pushPathChanged({ panelId: m.id, filePath: README, movedOut: false });

    await waitFor(() => expect(m!.preview.attach).toHaveBeenCalled());
    expect(m.preview.attach.mock.calls[0]![0].filePath).toBe(README);
    expect(await screen.findByText('Back again.', {}, COLD)).toBeVisible();
    expect(banners()).toHaveLength(0);
  });
});

describe('remounted moved out WITHOUT the store being reset (R26, US2 AS11)', () => {
  /** A preview that rendered the file, then unmounted (a project switch), then mounted again moved out. */
  async function remountMovedOut(extras?: ReturnType<typeof createElement>[]): Promise<MountedPreviewWindow> {
    const first = await mountMarkdownPreview('# Readme\n\nReadme body.\n');
    await screen.findByText('Readme body.', {}, COLD);
    first.unmount();
    document.body.replaceChildren();
    return mountMarkdownPreview('# unused\n', NEW, { config: { movedOut: true }, keepPreviewStore: true, extras });
  }
  const panelOf = (): Panel => collectPanels(m!.ws().layout!.tabs[0].root).find((p) => p.id === m!.id) as Panel;

  it('shows the moved notice, not the content it rendered before it unmounted', async () => {
    m = await remountMovedOut();

    await waitFor(() => expect(banners()).toHaveLength(1));
    expect((banner().textContent ?? '').replace(/\\/g, '/')).toContain(SENTENCE);
    expect(m.preview.attach).not.toHaveBeenCalled();
  });

  it('refuses to open or focus its linked editor, and the notice stays', async () => {
    m = await remountMovedOut();
    await waitFor(() => expect(banners()).toHaveLength(1));

    runPreviewEditorRoute(panelOf(), () => m!.ws() as never);
    await new Promise((r) => setTimeout(r, 20));

    expect(m.openInto, 'no editor is asked for or opened').not.toHaveBeenCalled();
    expect(banners()).toHaveLength(1);
  });

  it('disables the status bar button', async () => {
    m = await remountMovedOut();
    await waitFor(() => expect(banners()).toHaveLength(1));

    expect(await screen.findByTestId(`preview-editor-${m.id}`)).toBeDisabled();
  });

  it('disables the header menu and content menu rows', () => {
    const keybindings = { bindings: {} };
    const header = panelHeaderMenu({
      panel: { type: 'panel', id: 'x', kind: PREVIEW_KIND, title: 'P', config: { filePath: NEW, movedOut: true } },
      panelVerb: 'Destroy',
      keybindings,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      preview: { providerKind: 'text', parented: false },
      actions: new Proxy({}, { get: () => () => {} }),
    } as never) as unknown as { label?: string; disabled?: boolean }[];
    expect(header.find((i) => i.label === 'Open in Editor')?.disabled).toBe(true);

    const content = previewContentMenu({
      selectionEmpty: true,
      editorRoute: { parented: false, run: () => {}, disabled: true },
      find: { run: () => {} },
      goToHeading: { run: () => {} },
    } as never) as unknown as { label?: string; disabled?: boolean }[];
    expect(content.find((i) => i.label === 'Open in Editor')?.disabled).toBe(true);
  });

  it('becomes the preview again when main reports the file back in the project', async () => {
    m = await remountMovedOut([createElement(PreviewPathSync, { key: 'sync' })]);
    await waitFor(() => expect(banners()).toHaveLength(1));

    m.pushPathChanged({ panelId: m.id, filePath: README, movedOut: false });

    await waitFor(() => expect(banners()).toHaveLength(0));
    await waitFor(() => expect(m!.preview.attach).toHaveBeenCalled());
  });
});

describe('PreviewPathSync copies movedOut into the held layout (R19)', () => {
  it('writes movedOut: true beside the new path, and removes it when the file comes back', async () => {
    m = await mountMarkdownPreview('# Readme\n', README, { extras: [createElement(PreviewPathSync, { key: 'sync' })] });
    await waitFor(() => expect(m!.preview.attach).toHaveBeenCalled());

    m.pushPathChanged({ panelId: m.id, filePath: NEW, movedOut: true });
    await waitFor(() => expect(config()).toMatchObject({ filePath: NEW, movedOut: true }));

    m.pushPathChanged({ panelId: m.id, filePath: README, movedOut: false });
    await waitFor(() => expect(config()?.filePath).toBe(README));
    expect(config()).not.toHaveProperty('movedOut');
  });

  it('writes it from a moved-out update as well', async () => {
    m = await mountMarkdownPreview('# Readme\n', README, { extras: [createElement(PreviewPathSync, { key: 'sync' })] });
    await waitFor(() => expect(m!.preview.attach).toHaveBeenCalled());

    m.push(previewUpdate({ panelId: m.id, revision: 2, filePath: NEW, notice: { kind: 'moved-out', movedTo: NEW } }));

    await waitFor(() => expect(config()).toMatchObject({ filePath: NEW, movedOut: true }));
  });
});
