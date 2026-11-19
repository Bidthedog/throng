/**
 * 076 US1 / US2 — what a terminal panel does when one of its toggles is flipped (FR-003, FR-004, FR-005, FR-008,
 * FR-022; research R4, R5).
 *
 * Layer: component — the real `TerminalPanel` over the real workspace store, with `useTerminal` stubbed (no shell).
 * Resolution, the committed write, its failure path and the withdrawal message are all observable in jsdom: the
 * store's saves are the bridge's `workspace.save` calls, and the notice and the status bar are DOM.
 */
import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, type Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { runTerminalToggle } from '../../src/renderer/terminal/terminal-toggle-registry.js';

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: () => {},
}));
vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

const ROOT = 'C:/proj';
const PANEL = 'p-term-toggles';

/** The panel as the store holds it NOW — a window re-renders `TerminalPanel` from the layout, and so does this. */
function Host(): ReactElement | null {
  const { layout } = useWorkspace();
  const panel = layout?.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === PANEL);
  return panel ? createElement(TerminalPanel, { panel, tabId: 't1', projectRoot: ROOT }) : null;
}

let harness: EditorHarness | undefined;
let failSaves = false;
afterEach(() => {
  harness?.unmount();
  harness = undefined;
  failSaves = false;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mount(
  config: Record<string, unknown>,
  settings?: Record<string, unknown>,
  barShown = true,
): Promise<{ h: EditorHarness; panelIgnored: ReturnType<typeof vi.fn> }> {
  const panelIgnored = vi.fn();
  const layoutPanel = {
    type: 'panel',
    id: PANEL,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'cmd', flavourLabel: 'Command Prompt', ...config },
  } as unknown as Panel;
  const h = mountEditor({
    doc: { text: '\n', version: 1, absPath: null },
    projectRoot: ROOT,
    registerProject: true,
    settings,
    throng: { terminal: {}, attention: { panelIgnored } },
    layoutPanel,
    saveFails: () => failSaves,
    extras: [createElement(Host, { key: 'host' })],
  });
  harness = h;
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  if (barShown) await waitFor(() => expect(button('rememberCommand')).not.toBeNull());
  else await waitFor(() => expect(document.querySelector(`[data-testid="terminal-${PANEL}"]`)).not.toBeNull());
  return { h, panelIgnored };
}

const button = (id: string): HTMLButtonElement | null =>
  document.querySelector(`[data-testid="terminal-toggle-${id}-${PANEL}"]`);
const pressed = (id: string): string | null | undefined => button(id)?.getAttribute('aria-pressed');

describe('flipping a terminal toggle (076)', () => {
  it('shows the panel’s own value, else the preference — old panels included (FR-003, Q4)', async () => {
    await mount({ rememberCommand: true }, { terminals: { defaultRememberDirectory: false, defaultNotifications: false } });
    expect(pressed('rememberCommand')).toBe('true');
    expect(pressed('rememberDirectory')).toBe('false');
    expect(pressed('notifications')).toBe('false');
  });

  it('writes an explicit value for this panel at once, and touches no setting (FR-004, FR-008)', async () => {
    const user = userEvent.setup({ delay: null });
    const { h } = await mount({});
    await user.click(button('rememberCommand')!);
    await waitFor(() => expect(h.savedPanelConfig()?.rememberCommand).toBe(true));
    expect(pressed('rememberCommand')).toBe('true');
    await user.click(button('rememberDirectory')!);
    await waitFor(() => expect(h.savedPanelConfig()?.rememberDirectory).toBe(false));
    expect(h.settings().terminals.defaultRememberCommand).toBe(false);
  });

  it('a failed write shows what is stored and raises a notice naming the setting (FR-004)', async () => {
    const user = userEvent.setup({ delay: null });
    await mount({});
    failSaves = true;
    await user.click(button('rememberCommand')!);
    await waitFor(() => expect(document.querySelector('[data-testid="notice-terminal-toggle-failed"]')).not.toBeNull());
    expect(document.querySelector('[data-testid="notice-terminal-toggle-failed"]')!.textContent).toContain(
      'Remember the last running command',
    );
    await waitFor(() => expect(pressed('rememberCommand')).toBe('false'));
  });

  it('turning notifications off tells main once the write has landed; turning them on does not (FR-022)', async () => {
    const user = userEvent.setup({ delay: null });
    const { h, panelIgnored } = await mount({});
    expect(pressed('notifications')).toBe('true');
    await user.click(button('notifications')!);
    await waitFor(() => expect(panelIgnored).toHaveBeenCalledWith(PANEL));
    expect(h.savedPanelConfig()?.notifications).toBe(false);
    await user.click(button('notifications')!);
    await waitFor(() => expect(h.savedPanelConfig()?.notifications).toBe(true));
    expect(panelIgnored).toHaveBeenCalledTimes(1);
  });

  it('a failed write turning notifications off tells main nothing', async () => {
    const user = userEvent.setup({ delay: null });
    const { panelIgnored } = await mount({});
    failSaves = true;
    await user.click(button('notifications')!);
    await waitFor(() => expect(document.querySelector('[data-testid="notice-terminal-toggle-failed"]')).not.toBeNull());
    expect(panelIgnored).not.toHaveBeenCalled();
  });

  it('runs the same flip from the command registry the window dispatcher uses (FR-006)', async () => {
    const { h } = await mount({});
    act(() => {
      expect(runTerminalToggle(PANEL, 'rememberDirectory')).toBe(true);
    });
    await waitFor(() => expect(h.savedPanelConfig()?.rememberDirectory).toBe(false));
  });

  it('keeps the toggles in the menu with the status bar hidden, checked as stored, and flips from there (FR-005, SC-005)', async () => {
    const user = userEvent.setup({ delay: null });
    const { h } = await mount({ notifications: true }, { terminals: { showStatusBar: false } }, false);
    expect(document.querySelector(`[data-testid="terminal-status-bar-${PANEL}"]`)).toBeNull();
    const surface = document.querySelector(`[data-testid="terminal-${PANEL}"]`)!;
    await user.pointer({ keys: '[MouseRight]', target: surface });
    const item = (label: string): HTMLElement | null => document.querySelector(`[data-testid="menu-item-${label}"]`);
    await waitFor(() => expect(item('Terminal notifications')).not.toBeNull());
    expect(item('Remember the last running command')).not.toBeNull();
    expect(item('Reopen in the last directory')).not.toBeNull();
    expect(item('Terminal notifications')!.getAttribute('aria-checked')).toBe('true');
    await user.click(item('Terminal notifications')!);
    await waitFor(() => expect(h.savedPanelConfig()?.notifications).toBe(false));
  });
});
