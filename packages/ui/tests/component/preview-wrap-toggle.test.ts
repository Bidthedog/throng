/**
 * 073 FR-013 — the per-panel Wrap switch for a grid preview: a toggle on the preview's status bar beside the cell
 * dialog's, and a checked item in its header menu, both reaching one persisted per-panel choice, and the availability
 * rule (the panel's own choice, else the "Wrap cells" setting, which ships off).
 *
 * Layer: component — the toggle's state, keyboard reach and persistence need the real status bar, panel and
 * workspace store; the rule itself is unit-tested in core (`csv-cell-text.test.ts`). Mounted through the real
 * `PanelPlaceholder` with a TEST provider that declares `wrapToggle`, so the chrome is shown to name no provider.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, collectPanels, createPreviewProviderRegistry, type Panel } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

const GRID_FILE = 'D:/proj/table.prvgrid';
const PLAIN_FILE = 'D:/proj/notes.prvtxt';
const SETTING_LEAF = 'wrapCells';

const registry = createPreviewProviderRegistry([
  {
    id: 'testGrid',
    displayName: 'Test grid',
    extensions: ['.prvgrid'],
    kind: 'text',
    editable: true,
    wrapToggle: true,
    settings: [{ leaf: SETTING_LEAF, label: 'Wrap cells', description: 'x', control: 'toggle', default: false }],
  },
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

/** What the body was handed, so a test can read the choice the panel passes down. */
const seen: { wrapChoice?: boolean | undefined } = {};
function FakeBody({ panelId, wrapChoice }: PreviewBodyProps): ReactElement {
  seen.wrapChoice = wrapChoice;
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}
const views: Record<string, PreviewProviderView> = {
  testGrid: { id: 'testGrid', textSelection: true, load: () => Promise.resolve(FakeBody) },
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountGrid(opts: { setting?: boolean; config?: Record<string, unknown> } = {}): Promise<MountedPreviewWindow> {
  const settings =
    opts.setting === undefined ? undefined : { editor: { previews: { providers: { testGrid: { [SETTING_LEAF]: opts.setting } } } } };
  m = await mountMarkdownPreview('a,b\n', GRID_FILE, { providers: { registry, views }, providerId: 'testGrid', settings, config: opts.config });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`preview-wrap-${id}`);
const panelConfig = (win: MountedPreviewWindow): Record<string, unknown> | undefined => {
  const layout = win.ws().layout;
  const panel = layout?.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.kind === PREVIEW_KIND);
  return panel?.config as Record<string, unknown> | undefined;
};

afterEach(() => {
  m?.unmount();
  m = undefined;
  seen.wrapChoice = undefined;
  document.body.replaceChildren();
});

describe('the Wrap status-bar toggle (FR-013)', () => {
  it('is drawn for a provider that wraps, as a themed icon control naming its action', async () => {
    const win = await mountGrid();
    const button = toggle(win.id)!;
    expect(button).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('title')).toBe('Wrap cells: disabled');
    expect(button.getAttribute('aria-label')).toBe('Wrap cells: disabled');
    expect(button).toHaveClass('setting-toggle');
    expect(drawnIcon(button)).toBe(iconMarkup('wrapCells'));
  });

  it('is not drawn for a provider without one', async () => {
    m = await mountMarkdownPreview('hello', PLAIN_FILE, { providers: { registry, views }, providerId: 'testText' });
    await screen.findByTestId(`fake-body-${m.id}`);
    expect(toggle(m.id)).toBeNull();
  });

  it('sits beside the cell dialog toggle in the bar\'s controls', async () => {
    const win = await mountGrid();
    const bar = screen.getByTestId(`preview-status-bar-${win.id}`);
    expect([...bar.querySelectorAll('button')]).toContain(toggle(win.id));
  });

  it('shows the state: off by default, pressed when the setting is on, for a panel that has not chosen', async () => {
    const off = await mountGrid();
    expect(toggle(off.id)).toHaveAttribute('aria-pressed', 'false');
    off.unmount();
    document.body.replaceChildren();
    const on = await mountGrid({ setting: true });
    expect(toggle(on.id)).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the panel\'s own choice over the setting, either way', async () => {
    const forcedOn = await mountGrid({ setting: false, config: { wrapCells: true } });
    expect(toggle(forcedOn.id)).toHaveAttribute('aria-pressed', 'true');
    forcedOn.unmount();
    document.body.replaceChildren();
    const forcedOff = await mountGrid({ setting: true, config: { wrapCells: false } });
    expect(toggle(forcedOff.id)).toHaveAttribute('aria-pressed', 'false');
  });

  it('hands the body the panel\'s own choice, and nothing for a panel that has not chosen', async () => {
    const untouched = await mountGrid({ setting: true });
    expect(seen.wrapChoice).toBeUndefined();
    untouched.unmount();
    document.body.replaceChildren();
    await mountGrid({ setting: false, config: { wrapCells: true } });
    expect(seen.wrapChoice).toBe(true);
  });

  it('flips on a click and saves the choice with the panel, leaving other panel config alone', async () => {
    const win = await mountGrid({ setting: false });
    fireEvent.click(toggle(win.id)!);
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'true'));
    expect(panelConfig(win)).toMatchObject({ wrapCells: true, filePath: GRID_FILE });
    expect(toggle(win.id)).toHaveAttribute('title', 'Wrap cells: enabled');
    expect(toggle(win.id)).toHaveAccessibleName('Wrap cells: enabled');
    fireEvent.click(toggle(win.id)!);
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'false'));
    expect(panelConfig(win)).toMatchObject({ wrapCells: false });
  });

  it('is reachable and operable from the keyboard', async () => {
    const win = await mountGrid({ setting: false });
    const user = userEvent.setup();
    const button = toggle(win.id)!;
    expect(button.getAttribute('tabindex')).not.toBe('-1');
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'true'));
    await user.keyboard(' ');
    await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'false'));
  });

  it('survives a restart, leaves another panel alone, and an untouched panel follows the setting', async () => {
    const first = await mountGrid({ setting: false });
    fireEvent.click(toggle(first.id)!);
    await waitFor(() => expect(panelConfig(first)).toMatchObject({ wrapCells: true }));
    const saved = panelConfig(first)!;
    first.unmount();
    document.body.replaceChildren();

    const again = await mountGrid({ setting: false, config: { wrapCells: saved.wrapCells } });
    expect(toggle(again.id)).toHaveAttribute('aria-pressed', 'true');
    again.unmount();
    document.body.replaceChildren();

    const untouched = await mountGrid({ setting: false });
    expect(panelConfig(untouched)?.wrapCells).toBeUndefined();
    expect(toggle(untouched.id)).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the Wrap header menu item (every panel action has a menu item)', () => {
  const panel = (): Panel => ({
    type: 'panel',
    id: 'p1',
    originProjectId: 'proj',
    title: 'table.csv',
    kind: PREVIEW_KIND,
    config: { filePath: 'D:/proj/table.csv' },
  });
  const noop = (): void => {};
  const actionsWith = (toggleWrap: () => void): PanelHeaderMenuActions =>
    new Proxy({} as PanelHeaderMenuActions, { get: (_t, key) => (key === 'toggleWrap' ? toggleWrap : noop) });
  const build = (wrap: { on: boolean } | undefined, run: () => void = noop): MenuAction[] =>
    panelHeaderMenu({
      panel: panel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      actions: actionsWith(run),
      preview: { providerKind: 'text', parented: false, flowingDocument: false, ...(wrap ? { wrap } : {}) },
    });
  const item = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.testId === 'menu-item-Wrap');

  it('offers a checked toggle in View & state with the wrapCells icon, checked exactly while wrapping is on', () => {
    expect(item(build({ on: true }))).toMatchObject({ checked: true, section: 'viewState', icon: 'wrapCells' });
    expect(item(build({ on: false }))).toMatchObject({ checked: false });
  });

  it('is absent for a provider that does not wrap', () => {
    expect(item(build(undefined))).toBeUndefined();
  });

  it('runs the one toggle when chosen', () => {
    const run = vi.fn();
    item(build({ on: false }, run))?.onClick?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is on the mounted panel\'s menu, checked from the panel\'s own choice', async () => {
    const win = await mountGrid({ setting: false, config: { wrapCells: true } });
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${win.id}`), { clientX: 10, clientY: 10 });
    const entry = await screen.findByTestId('menu-item-Wrap');
    expect(entry).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(entry);
    await waitFor(() => expect(panelConfig(win)).toMatchObject({ wrapCells: false }));
  });
});
