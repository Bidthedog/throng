/**
 * 073 FR-039a / FR-013 / FR-036b — the per-panel switches a grid preview offers on its status bar and in its header
 * menu: Lock first row, Lock first column (FR-039a), Wrap (FR-013) and the CSV cell dialog (FR-036b). Each is a toggle
 * on the preview's status bar and a checked item in its header menu, each reaching one persisted per-panel choice, and
 * the availability rule (the panel's own choice, else the provider's setting).
 *
 * v1 review (#732, amending FR-013 and FR-039a): Wrap and the two locks change how the grid shows its cells, so they
 * left the header menu for the grid's own body menus. The panel hands the body each one as `gridToggles` (its value
 * and the status bar's flip), and `gridViewToggleRows` draws them; the cell dialog toggle stays on the header menu.
 *
 * Layer: component — the toggles' state, keyboard reach and persistence need the real status bar, panel and workspace
 * store; the rule is unit-tested in core (`csv-cell-text.test.ts`). Mounted through the real `PanelPlaceholder` with
 * TEST providers that declare `lockToggles` / `wrapToggle` / `cellDialog`, so the chrome is shown to name no provider.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, collectPanels, createPreviewProviderRegistry, type Panel } from '@throng/core';
import type { GridViewToggles, PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { gridViewToggleRows } from '../../src/renderer/grid/grid-menu-items.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

const PLAIN_FILE = 'D:/proj/notes.prvtxt';

const registry = createPreviewProviderRegistry([
  {
    id: 'testLock',
    displayName: 'Test lock grid',
    extensions: ['.prvlock'],
    kind: 'text',
    editable: true,
    lockToggles: true,
    settings: [
      { leaf: 'lockFirstRow', label: 'Lock first row', description: 'x', control: 'toggle', default: false },
      { leaf: 'lockFirstColumn', label: 'Lock first column', description: 'x', control: 'toggle', default: false },
    ],
  },
  {
    id: 'testWrap',
    displayName: 'Test wrap grid',
    extensions: ['.prvwrap'],
    kind: 'text',
    editable: true,
    wrapToggle: true,
    settings: [{ leaf: 'wrapCells', label: 'Wrap cells', description: 'x', control: 'toggle', default: false }],
  },
  {
    id: 'testCell',
    displayName: 'Test cell-dialog grid',
    extensions: ['.prvcell'],
    kind: 'text',
    editable: true,
    cellDialog: true,
    settings: [{ leaf: 'editLongCellsInDialog', label: 'Edit long cells in a dialog', description: 'x', control: 'toggle', default: true }],
  },
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

/** What the body was handed, so a test can read the choices the panel passes down. */
const seen: Record<string, boolean | undefined> = {};
/** The grid toggles the body was last handed (v1 review, #732). */
const handed: { toggles: GridViewToggles | undefined } = { toggles: undefined };
function FakeBody({ panelId, wrapChoice, lockFirstRowChoice, lockFirstColumnChoice, cellDialogChoice, gridToggles }: PreviewBodyProps): ReactElement {
  handed.toggles = gridToggles;
  seen.wrapChoice = wrapChoice;
  seen.lockFirstRowChoice = lockFirstRowChoice;
  seen.lockFirstColumnChoice = lockFirstColumnChoice;
  seen.cellDialogChoice = cellDialogChoice;
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}
const view = (id: string): PreviewProviderView => ({ id, textSelection: true, load: () => Promise.resolve(FakeBody) });
const views: Record<string, PreviewProviderView> = Object.fromEntries(
  ['testLock', 'testWrap', 'testCell', 'testText'].map((id) => [id, view(id)]),
);

let m: MountedPreviewWindow | undefined;

const panelConfig = (win: MountedPreviewWindow): Record<string, unknown> | undefined => {
  const layout = win.ws().layout;
  const panel = layout?.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.kind === PREVIEW_KIND);
  return panel?.config as Record<string, unknown> | undefined;
};

afterEach(() => {
  m?.unmount();
  m = undefined;
  for (const key of Object.keys(seen)) seen[key] = undefined;
  handed.toggles = undefined;
  document.body.replaceChildren();
});

interface Kind {
  /** The provider (and its file extension) that declares this toggle. */
  readonly provider: 'testLock' | 'testWrap' | 'testCell';
  readonly file: string;
  /** The settings leaf the toggle follows, and the key the panel's own choice is saved under. */
  readonly leaf: string;
  readonly configKey: string;
  /** What the setting ships as: the state of a panel that has not chosen. */
  readonly defaultOn: boolean;
  readonly testId: string;
  readonly name: string;
  readonly menu: string;
  readonly icon: string;
  /** The `PanelHeaderMenuActions` member the menu item runs, and the `preview` key that carries its state. */
  readonly actions: string;
  readonly previewKey: string;
  /** The prop the panel hands the body. */
  readonly seenKey: string;
}

const KINDS: readonly Kind[] = [
  { provider: 'testLock', file: 'D:/proj/table.prvlock', leaf: 'lockFirstRow', configKey: 'lockFirstRow', defaultOn: false, testId: 'preview-lock-row', name: 'Lock first row', menu: 'Lock First Row', icon: 'lockFirstRow', actions: 'toggleLockFirstRow', previewKey: 'lockFirstRow', seenKey: 'lockFirstRowChoice' },
  { provider: 'testLock', file: 'D:/proj/table.prvlock', leaf: 'lockFirstColumn', configKey: 'lockFirstColumn', defaultOn: false, testId: 'preview-lock-column', name: 'Lock first column', menu: 'Lock First Column', icon: 'lockFirstColumn', actions: 'toggleLockFirstColumn', previewKey: 'lockFirstColumn', seenKey: 'lockFirstColumnChoice' },
  { provider: 'testWrap', file: 'D:/proj/table.prvwrap', leaf: 'wrapCells', configKey: 'wrapCells', defaultOn: false, testId: 'preview-wrap', name: 'Wrap cells', menu: 'Wrap', icon: 'wrapCells', actions: 'toggleWrap', previewKey: 'wrap', seenKey: 'wrapChoice' },
  { provider: 'testCell', file: 'D:/proj/table.prvcell', leaf: 'editLongCellsInDialog', configKey: 'cellDialog', defaultOn: true, testId: 'preview-cell-dialog', name: 'Edit long cells in a dialog', menu: 'Edit Long Cells in Dialog', icon: 'cellDialog', actions: 'toggleCellDialog', previewKey: 'cellDialog', seenKey: 'cellDialogChoice' },
];

async function mountGrid(
  k: Kind,
  opts: { setting?: boolean; config?: Record<string, unknown> } = {},
): Promise<MountedPreviewWindow> {
  const settings =
    opts.setting === undefined ? undefined : { editor: { previews: { providers: { [k.provider]: { [k.leaf]: opts.setting } } } } };
  m = await mountMarkdownPreview('a,b\n', k.file, { providers: { registry, views }, providerId: k.provider, settings, config: opts.config });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const stateWord = (on: boolean): string => (on ? 'enabled' : 'disabled');

for (const k of KINDS) {
  const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`${k.testId}-${id}`);
  const start = k.defaultOn;

  describe(`the ${k.name} status-bar toggle`, () => {
    it('is drawn for a provider that declares it, as a themed icon control naming its action', async () => {
      const win = await mountGrid(k);
      const button = toggle(win.id)!;
      expect(button).not.toBeNull();
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('title')).toBe(`${k.name}: ${stateWord(start)}`);
      expect(button.getAttribute('aria-label')).toBe(`${k.name}: ${stateWord(start)}`);
      expect(button).toHaveClass('setting-toggle');
      expect(drawnIcon(button)).toBe(iconMarkup(k.icon));
    });

    it('is not drawn for a provider without one', async () => {
      m = await mountMarkdownPreview('hello', PLAIN_FILE, { providers: { registry, views }, providerId: 'testText' });
      await screen.findByTestId(`fake-body-${m.id}`);
      expect(toggle(m.id)).toBeNull();
    });

    it('shows the state: the setting\'s value, and its shipped default when unset, for a panel that has not chosen', async () => {
      const unset = await mountGrid(k);
      expect(toggle(unset.id)).toHaveAttribute('aria-pressed', String(start));
      unset.unmount();
      document.body.replaceChildren();
      const on = await mountGrid(k, { setting: true });
      expect(toggle(on.id)).toHaveAttribute('aria-pressed', 'true');
      on.unmount();
      document.body.replaceChildren();
      const off = await mountGrid(k, { setting: false });
      expect(toggle(off.id)).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the panel\'s own choice over the setting, either way', async () => {
      const forcedOn = await mountGrid(k, { setting: false, config: { [k.configKey]: true } });
      expect(toggle(forcedOn.id)).toHaveAttribute('aria-pressed', 'true');
      forcedOn.unmount();
      document.body.replaceChildren();
      const forcedOff = await mountGrid(k, { setting: true, config: { [k.configKey]: false } });
      expect(toggle(forcedOff.id)).toHaveAttribute('aria-pressed', 'false');
    });

    it('hands the body the panel\'s own choice, and nothing for a panel that has not chosen', async () => {
      const untouched = await mountGrid(k, { setting: true });
      expect(seen[k.seenKey]).toBeUndefined();
      untouched.unmount();
      document.body.replaceChildren();
      await mountGrid(k, { setting: false, config: { [k.configKey]: true } });
      expect(seen[k.seenKey]).toBe(true);
    });

    it('flips on a click and saves the choice with the panel, leaving other panel config alone', async () => {
      const win = await mountGrid(k, { setting: start });
      fireEvent.click(toggle(win.id)!);
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', String(!start)));
      expect(panelConfig(win)).toMatchObject({ [k.configKey]: !start, filePath: k.file });
      expect(toggle(win.id)).toHaveAttribute('title', `${k.name}: ${stateWord(!start)}`);
      expect(toggle(win.id)).toHaveAccessibleName(`${k.name}: ${stateWord(!start)}`);
      fireEvent.click(toggle(win.id)!);
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', String(start)));
      expect(panelConfig(win)).toMatchObject({ [k.configKey]: start });
    });

    it('is reachable and operable from the keyboard', async () => {
      const win = await mountGrid(k, { setting: start });
      const user = userEvent.setup();
      const button = toggle(win.id)!;
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      button.focus();
      expect(button).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', String(!start)));
      await user.keyboard(' ');
      await waitFor(() => expect(toggle(win.id)).toHaveAttribute('aria-pressed', String(start)));
    });

    it('survives a restart, and an untouched panel follows the setting', async () => {
      const first = await mountGrid(k, { setting: start });
      fireEvent.click(toggle(first.id)!);
      await waitFor(() => expect(panelConfig(first)).toMatchObject({ [k.configKey]: !start }));
      const saved = panelConfig(first)!;
      first.unmount();
      document.body.replaceChildren();
      const again = await mountGrid(k, { setting: start, config: { [k.configKey]: saved[k.configKey] } });
      expect(toggle(again.id)).toHaveAttribute('aria-pressed', String(!start));
      again.unmount();
      document.body.replaceChildren();
      const untouched = await mountGrid(k, { setting: start });
      expect(panelConfig(untouched)?.[k.configKey]).toBeUndefined();
      expect(toggle(untouched.id)).toHaveAttribute('aria-pressed', String(start));
    });
  });

  if (k.provider === 'testCell') describe(`the ${k.menu} header menu item (every panel action has a menu item)`, () => {
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
        preview: { providerKind: 'text', parented: false, flowingDocument: false, ...(state ? { [k.previewKey]: state } : {}) },
      });
    const item = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.testId === `menu-item-${k.menu}`);

    it('offers a checked toggle in View & state with its icon, checked exactly while it is on', () => {
      expect(item(build({ on: true }))).toMatchObject({ checked: true, section: 'viewState', icon: k.icon });
      expect(item(build({ on: false }))).toMatchObject({ checked: false });
    });

    it('is absent for a provider that does not declare it', () => {
      expect(item(build(undefined))).toBeUndefined();
    });

    it('runs the one toggle when chosen', () => {
      const run = vi.fn();
      item(build({ on: false }, run))?.onClick?.();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('is on the mounted panel\'s menu, checked from the panel\'s own choice', async () => {
      const win = await mountGrid(k, { setting: start, config: { [k.configKey]: !start } });
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${win.id}`), { clientX: 10, clientY: 10 });
      const entry = await screen.findByTestId(`menu-item-${k.menu}`);
      expect(entry).toHaveAttribute('aria-checked', String(!start));
      fireEvent.click(entry);
      await waitFor(() => expect(panelConfig(win)).toMatchObject({ [k.configKey]: start }));
    });
  });

  if (k.provider !== 'testCell') describe(`the ${k.menu} grid body menu item (v1 review, #732)`, () => {
    const key = k.previewKey as keyof GridViewToggles;

    it('is no longer on the mounted panel\'s header menu', async () => {
      const win = await mountGrid(k, { setting: start });
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${win.id}`), { clientX: 10, clientY: 10 });
      await screen.findByTestId('menu-item-Send to Tab');
      expect(screen.queryByTestId(`menu-item-${k.menu}`)).toBeNull();
    });

    it('offers a checked toggle in View & state with its icon, checked exactly while it is on, and runs the flip', () => {
      const run = vi.fn();
      const row = (on: boolean): MenuAction | undefined =>
        gridViewToggleRows({ [key]: { on, onToggle: run } }).find((i) => i.testId === `menu-item-${k.menu}`);
      expect(row(true)).toMatchObject({ checked: true, section: 'viewState', icon: k.icon });
      expect(row(false)).toMatchObject({ checked: false });
      row(false)?.onClick?.();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('is absent for a provider that does not declare it', () => {
      expect(gridViewToggleRows({}).find((i) => i.testId === `menu-item-${k.menu}`)).toBeUndefined();
    });

    it('the panel hands the body its own choice, and the flip saves it with the panel', async () => {
      const win = await mountGrid(k, { setting: start, config: { [k.configKey]: !start } });
      await waitFor(() => expect(handed.toggles?.[key]?.on).toBe(!start));
      handed.toggles![key]!.onToggle();
      await waitFor(() => expect(panelConfig(win)).toMatchObject({ [k.configKey]: start }));
      await waitFor(() => expect(handed.toggles?.[key]?.on).toBe(start));
    });
  });
}

describe('the Wrap and cell dialog toggles in the status bar', () => {
  const [, , wrap, cell] = KINDS as readonly [Kind, Kind, Kind, Kind];

  it('Wrap sits beside the cell dialog toggle in the bar\'s controls', async () => {
    const win = await mountGrid(wrap);
    const bar = screen.getByTestId(`preview-status-bar-${win.id}`);
    expect([...bar.querySelectorAll('button')]).toContain(screen.queryByTestId(`${wrap.testId}-${win.id}`));
  });

  it('the cell dialog toggle sits at the trailing end of the bar, among its controls', async () => {
    const win = await mountGrid(cell);
    const bar = screen.getByTestId(`preview-status-bar-${win.id}`);
    const controls = [...bar.querySelectorAll('button')];
    const button = screen.queryByTestId(`${cell.testId}-${win.id}`);
    expect(controls).toContain(button);
    expect(controls.at(-1)).toBe(button);
  });
});
