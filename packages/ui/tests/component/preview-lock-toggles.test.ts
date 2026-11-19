/**
 * 073 FR-039a — the per-panel Lock first row / Lock first column switches for a grid preview: two toggles on the
 * preview's status bar beside Wrap, and two checked items in its header menu, each reaching one persisted per-panel
 * choice, and the availability rule (the panel's own choice, else the "Lock first row" / "Lock first column" setting,
 * which ship off).
 *
 * Layer: component — the toggles' state, keyboard reach and persistence need the real status bar, panel and workspace
 * store; the rule is unit-tested in core (`csv-cell-text.test.ts`). Mounted through the real `PanelPlaceholder` with a
 * TEST provider that declares `lockToggles`, so the chrome is shown to name no provider.
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

const registry = createPreviewProviderRegistry([
  {
    id: 'testGrid',
    displayName: 'Test grid',
    extensions: ['.prvgrid'],
    kind: 'text',
    editable: true,
    lockToggles: true,
    settings: [
      { leaf: 'lockFirstRow', label: 'Lock first row', description: 'x', control: 'toggle', default: false },
      { leaf: 'lockFirstColumn', label: 'Lock first column', description: 'x', control: 'toggle', default: false },
    ],
  },
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

/** What the body was handed, so a test can read the choices the panel passes down. */
const seen: { row?: boolean | undefined; column?: boolean | undefined } = {};
function FakeBody({ panelId, lockFirstRowChoice, lockFirstColumnChoice }: PreviewBodyProps): ReactElement {
  seen.row = lockFirstRowChoice;
  seen.column = lockFirstColumnChoice;
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}
const views: Record<string, PreviewProviderView> = {
  testGrid: { id: 'testGrid', textSelection: true, load: () => Promise.resolve(FakeBody) },
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountGrid(opts: { settings?: { lockFirstRow?: boolean; lockFirstColumn?: boolean }; config?: Record<string, unknown> } = {}): Promise<MountedPreviewWindow> {
  const settings = opts.settings === undefined ? undefined : { editor: { previews: { providers: { testGrid: opts.settings } } } };
  m = await mountMarkdownPreview('a,b\n', GRID_FILE, { providers: { registry, views }, providerId: 'testGrid', settings, config: opts.config });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const panelConfig = (win: MountedPreviewWindow): Record<string, unknown> | undefined => {
  const layout = win.ws().layout;
  const panel = layout?.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.kind === PREVIEW_KIND);
  return panel?.config as Record<string, unknown> | undefined;
};

afterEach(() => {
  m?.unmount();
  m = undefined;
  seen.row = undefined;
  seen.column = undefined;
  document.body.replaceChildren();
});

const KINDS = [
  { key: 'lockFirstRow', testId: 'preview-lock-row', name: 'Lock first row', menu: 'Lock First Row', icon: 'lockFirstRow', actions: 'toggleLockFirstRow', seenKey: 'row' },
  { key: 'lockFirstColumn', testId: 'preview-lock-column', name: 'Lock first column', menu: 'Lock First Column', icon: 'lockFirstColumn', actions: 'toggleLockFirstColumn', seenKey: 'column' },
] as const;

for (const k of KINDS) {
  const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`${k.testId}-${id}`);

  describe(`the ${k.name} status-bar toggle (FR-039a)`, () => {
    it('is drawn for a provider that locks, as a themed icon control naming its action', async () => {
      const win = await mountGrid();
      const button = toggle(win.id)!;
      expect(button).not.toBeNull();
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('title')).toBe(k.name);
      expect(button.getAttribute('aria-label')).toBe(k.name);
      expect(drawnIcon(button)).toBe(iconMarkup(k.icon));
    });

    it('is not drawn for a provider without one', async () => {
      m = await mountMarkdownPreview('hello', PLAIN_FILE, { providers: { registry, views }, providerId: 'testText' });
      await screen.findByTestId(`fake-body-${m.id}`);
      expect(toggle(m.id)).toBeNull();
    });

    it('shows the state: off by default, pressed when the setting is on, for a panel that has not chosen', async () => {
      const off = await mountGrid();
      expect(toggle(off.id)).toHaveAttribute('aria-pressed', 'false');
      off.unmount();
      document.body.replaceChildren();
      const on = await mountGrid({ settings: { [k.key]: true } });
      expect(toggle(on.id)).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the panel\'s own choice over the setting, either way', async () => {
      const forcedOn = await mountGrid({ settings: { [k.key]: false }, config: { [k.key]: true } });
      expect(toggle(forcedOn.id)).toHaveAttribute('aria-pressed', 'true');
      forcedOn.unmount();
      document.body.replaceChildren();
      const forcedOff = await mountGrid({ settings: { [k.key]: true }, config: { [k.key]: false } });
      expect(toggle(forcedOff.id)).toHaveAttribute('aria-pressed', 'false');
    });

    it('hands the body the panel\'s own choice, and nothing for a panel that has not chosen', async () => {
      const untouched = await mountGrid({ settings: { [k.key]: true } });
      expect(seen[k.seenKey]).toBeUndefined();
      untouched.unmount();
      document.body.replaceChildren();
      await mountGrid({ settings: { [k.key]: false }, config: { [k.key]: true } });
      expect(seen[k.seenKey]).toBe(true);
    });

    it('flips on a click and saves the choice with the panel, leaving other panel config alone', async () => {
      const win = await mountGrid({ settings: { [k.key]: false } });
      fireEvent.click(toggle(win.id)!);
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'true'));
      expect(panelConfig(win)).toMatchObject({ [k.key]: true, filePath: GRID_FILE });
      fireEvent.click(toggle(win.id)!);
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', 'false'));
      expect(panelConfig(win)).toMatchObject({ [k.key]: false });
    });

    it('is reachable and operable from the keyboard', async () => {
      const win = await mountGrid();
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

    it('survives a restart, and an untouched panel follows the setting', async () => {
      const first = await mountGrid();
      fireEvent.click(toggle(first.id)!);
      await waitFor(() => expect(panelConfig(first)).toMatchObject({ [k.key]: true }));
      const saved = panelConfig(first)!;
      first.unmount();
      document.body.replaceChildren();
      const again = await mountGrid({ config: { [k.key]: saved[k.key] } });
      expect(toggle(again.id)).toHaveAttribute('aria-pressed', 'true');
      again.unmount();
      document.body.replaceChildren();
      const untouched = await mountGrid();
      expect(panelConfig(untouched)?.[k.key]).toBeUndefined();
      expect(toggle(untouched.id)).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe(`the ${k.menu} header menu item (every panel action has a menu item)`, () => {
    const panel = (): Panel => ({
      type: 'panel',
      id: 'p1',
      originProjectId: 'proj',
      title: 'table.csv',
      kind: PREVIEW_KIND,
      config: { filePath: 'D:/proj/table.csv' },
    });
    const noop = (): void => {};
    const actionsWith = (run: () => void): PanelHeaderMenuActions =>
      new Proxy({} as PanelHeaderMenuActions, { get: (_t, key) => (key === k.actions ? run : noop) });
    const build = (state: { on: boolean } | undefined, run: () => void = noop): MenuAction[] =>
      panelHeaderMenu({
        panel: panel(),
        panelVerb: 'Destroy',
        keybindings: DEFAULT_KEYBINDINGS,
        otherTabs: [],
        editor: null,
        panelFailure: false,
        detach: null,
        actions: actionsWith(run),
        preview: { providerKind: 'text', parented: false, flowingDocument: false, ...(state ? { [k.key]: state } : {}) },
      });
    const item = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.testId === `menu-item-${k.menu}`);

    it('offers a checked toggle in View & state with its icon, checked exactly while the lock is on', () => {
      expect(item(build({ on: true }))).toMatchObject({ checked: true, section: 'viewState', icon: k.icon });
      expect(item(build({ on: false }))).toMatchObject({ checked: false });
    });

    it('is absent for a provider that does not lock', () => {
      expect(item(build(undefined))).toBeUndefined();
    });

    it('runs the one toggle when chosen', () => {
      const run = vi.fn();
      item(build({ on: false }, run))?.onClick?.();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('is on the mounted panel\'s menu, checked from the panel\'s own choice', async () => {
      const win = await mountGrid({ settings: { [k.key]: false }, config: { [k.key]: true } });
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${win.id}`), { clientX: 10, clientY: 10 });
      const entry = await screen.findByTestId(`menu-item-${k.menu}`);
      expect(entry).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(entry);
      await waitFor(() => expect(panelConfig(win)).toMatchObject({ [k.key]: false }));
    });
  });
}
