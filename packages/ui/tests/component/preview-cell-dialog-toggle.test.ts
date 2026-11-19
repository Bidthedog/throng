/**
 * 073 FR-036b — the per-panel switch for the CSV cell dialog: a toggle at the trailing end of the preview's
 * status bar and a checked item in its header menu, both reaching one persisted per-panel choice, and the
 * availability rule (the panel's own choice, else the "Edit long cells in a dialog" setting).
 *
 * Layer: component — the toggle's state, keyboard reach and persistence need the real status bar, panel and
 * workspace store; the rule itself is unit-tested in core (`csv-cell-text.test.ts`). Mounted through the real
 * `PanelPlaceholder` with a TEST provider that declares `cellDialog`, so the chrome is shown to name no provider.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, collectPanels, createPreviewProviderRegistry, type Panel } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
} from '../../src/renderer/workspace/panel-header-menu.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

const GRID_FILE = 'D:/proj/table.prvgrid';
const PLAIN_FILE = 'D:/proj/notes.prvtxt';
const SETTING_LEAF = 'editLongCellsInDialog';

const registry = createPreviewProviderRegistry([
  {
    id: 'testGrid',
    displayName: 'Test grid',
    extensions: ['.prvgrid'],
    kind: 'text',
    editable: true,
    cellDialog: true,
    settings: [{ leaf: SETTING_LEAF, label: 'Edit long cells in a dialog', description: 'x', control: 'toggle', default: true }],
  },
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

function FakeBody({ panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}
const views: Record<string, PreviewProviderView> = {
  testGrid: { id: 'testGrid', textSelection: true, load: () => Promise.resolve(FakeBody) },
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountGrid(
  opts: { setting?: boolean; config?: Record<string, unknown> } = {},
): Promise<MountedPreviewWindow> {
  const settings =
    opts.setting === undefined
      ? undefined
      : { editor: { previews: { providers: { testGrid: { [SETTING_LEAF]: opts.setting } } } } };
  m = await mountMarkdownPreview('a,b\n', GRID_FILE, {
    providers: { registry, views },
    providerId: 'testGrid',
    settings,
    config: opts.config,
  });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`preview-cell-dialog-${id}`);
const panelConfig = (win: MountedPreviewWindow): Record<string, unknown> | undefined => {
  const layout = win.ws().layout;
  const panel = layout?.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.kind === PREVIEW_KIND);
  return panel?.config as Record<string, unknown> | undefined;
};

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('the status-bar toggle (FR-036b)', () => {
  it('is drawn for a provider with a cell dialog, as a themed icon control naming its action', async () => {
    const win = await mountGrid();
    const button = toggle(win.id)!;
    expect(button).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('title')).toContain('Edit long cells in a dialog');
    expect(drawnIcon(button)).toBe(iconMarkup('cellDialog'));
  });

  it('is not drawn for a provider without one', async () => {
    m = await mountMarkdownPreview('hello', PLAIN_FILE, { providers: { registry, views }, providerId: 'testText' });
    await screen.findByTestId(`fake-body-${m.id}`);
    expect(toggle(m.id)).toBeNull();
  });

  it('sits at the trailing end of the bar, among its controls', async () => {
    const win = await mountGrid();
    const bar = screen.getByTestId(`preview-status-bar-${win.id}`);
    const controls = [...bar.querySelectorAll('button')];
    expect(controls).toContain(toggle(win.id));
    expect(controls.at(-1)).toBe(toggle(win.id));
  });

  it('shows the state: pressed while the dialog is on, following the setting for a panel that has not chosen', async () => {
    const on = await mountGrid({ setting: true });
    expect(toggle(on.id)).toHaveAttribute('aria-pressed', 'true');
    on.unmount();
    document.body.replaceChildren();
    const off = await mountGrid({ setting: false });
    expect(toggle(off.id)).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the panel\'s own choice over the setting, either way', async () => {
    const forcedOn = await mountGrid({ setting: false, config: { cellDialog: true } });
    expect(toggle(forcedOn.id)).toHaveAttribute('aria-pressed', 'true');
    forcedOn.unmount();
    document.body.replaceChildren();
    const forcedOff = await mountGrid({ setting: true, config: { cellDialog: false } });
    expect(toggle(forcedOff.id)).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips on a click and saves the choice with the panel, leaving other panel config alone', async () => {
    const win = await mountGrid({ setting: true });
    fireEvent.click(toggle(win.id)!);
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'false'));
    expect(panelConfig(win)).toMatchObject({ cellDialog: false, filePath: GRID_FILE });
    fireEvent.click(toggle(win.id)!);
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'true'));
    expect(panelConfig(win)).toMatchObject({ cellDialog: true });
  });

  it('is reachable and operable from the keyboard', async () => {
    const win = await mountGrid({ setting: true });
    const user = userEvent.setup();
    const button = toggle(win.id)!;
    expect(button.getAttribute('tabindex')).not.toBe('-1');
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'false'));
    await user.keyboard(' ');
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'true'));
  });

  it('survives a restart: a remounted panel holding the saved choice shows it, and an untouched one follows the setting', async () => {
    const first = await mountGrid({ setting: true });
    fireEvent.click(toggle(first.id)!);
    await waitFor(() => expect(panelConfig(first)).toMatchObject({ cellDialog: false }));
    const saved = panelConfig(first)!;
    first.unmount();
    document.body.replaceChildren();

    const again = await mountGrid({ setting: true, config: { cellDialog: saved.cellDialog } });
    expect(toggle(again.id)).toHaveAttribute('aria-pressed', 'false');
    again.unmount();
    document.body.replaceChildren();

    const untouched = await mountGrid({ setting: true });
    expect(panelConfig(untouched)?.cellDialog).toBeUndefined();
    expect(toggle(untouched.id)).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the header menu item (every panel action has a menu item)', () => {
  const panel = (): Panel => ({
    type: 'panel',
    id: 'p1',
    originProjectId: 'proj',
    title: 'table.csv',
    kind: PREVIEW_KIND,
    config: { filePath: 'D:/proj/table.csv' },
  });
  const noop = (): void => {};
  const actionsWith = (toggleCellDialog: () => void): PanelHeaderMenuActions =>
    new Proxy({} as PanelHeaderMenuActions, { get: (_t, key) => (key === 'toggleCellDialog' ? toggleCellDialog : noop) });
  const build = (cellDialog: { on: boolean } | undefined, run: () => void = noop): MenuAction[] =>
    panelHeaderMenu({
      panel: panel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      actions: actionsWith(run),
      preview: { providerKind: 'text', parented: false, flowingDocument: false, ...(cellDialog ? { cellDialog } : {}) },
    });
  const item = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.testId === 'menu-item-Edit Long Cells in Dialog');

  it('offers a checked toggle in View & state with the cellDialog icon, checked exactly while the dialog is on', () => {
    expect(item(build({ on: true }))).toMatchObject({ checked: true, section: 'viewState', icon: 'cellDialog' });
    expect(item(build({ on: false }))).toMatchObject({ checked: false });
  });

  it('is absent for a provider with no cell dialog', () => {
    expect(item(build(undefined))).toBeUndefined();
  });

  it('runs the one toggle when chosen', () => {
    const run = vi.fn();
    item(build({ on: true }, run))?.onClick?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is on the mounted panel\'s menu, checked from the panel\'s own choice', async () => {
    const win = await mountGrid({ setting: true, config: { cellDialog: false } });
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${win.id}`), { clientX: 10, clientY: 10 });
    const entry = await screen.findByTestId('menu-item-Edit Long Cells in Dialog');
    expect(entry).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(entry);
    await waitFor(() => expect(panelConfig(win)).toMatchObject({ cellDialog: true }));
  });
});
