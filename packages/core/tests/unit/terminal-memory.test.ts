import { describe, it, expect } from 'vitest';
import {
  clearPanelType,
  readTerminalPanelConfig,
  setPanelType,
  setTerminalMemory,
} from '@throng/core';
import type { WorkspaceLayout } from '@throng/core';

function layout(): WorkspaceLayout {
  return {
    tabs: [
      {
        id: 't1',
        name: 'Tab 1',
        root: { type: 'panel', id: 'p1' },
      },
    ],
    activeTabId: 't1',
  } as unknown as WorkspaceLayout;
}

function panelOf(l: WorkspaceLayout): Record<string, unknown> {
  return l.tabs[0]!.root as unknown as Record<string, unknown>;
}

describe('Panel.terminalMemory (025 FR-007a/FR-007d)', () => {
  it('setTerminalMemory merges rather than replacing, so one writer cannot clobber another', () => {
    let l = setTerminalMemory(layout(), 'p1', { startupCommand: 'npm run dev' });
    l = setTerminalMemory(l, 'p1', { lastCwd: 'C:/proj/src' });
    expect(panelOf(l).terminalMemory).toEqual({
      startupCommand: 'npm run dev',
      lastCwd: 'C:/proj/src',
    });
  });

  it('records memory on an UNTYPED panel too — the terminal has ended by then', () => {
    // This is the whole point: capture happens as the terminal goes away, and by that moment
    // clearPanelType has already run.
    const l = setTerminalMemory(layout(), 'p1', { startupCommand: 'ping -t bbc.co.uk' });
    expect((panelOf(l).terminalMemory as Record<string, unknown>).startupCommand).toBe(
      'ping -t bbc.co.uk',
    );
  });

  /**
   * The constraint the whole feature turns on. `clearPanelType` deletes `kind` and `config`
   * when a terminal's content ends — which is exactly the moment the Panel must REMEMBER what
   * it was running. Storing memory in `config` alone would erase it at the instant it matters,
   * and the pre-filled form (FR-007a) would have nothing to read.
   */
  it('clearPanelType PRESERVES terminalMemory while still clearing kind and config', () => {
    let l = setPanelType(layout(), 'p1', 'terminal', {
      flavourId: 'cmd',
      shellArguments: '/K',
    } as never);
    l = setTerminalMemory(l, 'p1', {
      flavourId: 'cmd',
      shellArguments: '/K',
      startupCommand: 'npm run dev',
      rememberCommand: true,
      lastCwd: 'C:/proj/src',
    });

    const cleared = clearPanelType(l, 'p1');
    const panel = panelOf(cleared);

    expect(panel.kind).toBeUndefined();
    expect(panel.config).toBeUndefined();
    expect(panel.terminalMemory).toEqual({
      flavourId: 'cmd',
      shellArguments: '/K',
      startupCommand: 'npm run dev',
      rememberCommand: true,
      lastCwd: 'C:/proj/src',
    });
  });

  it('a panel that never had memory still clears cleanly', () => {
    const l = setPanelType(layout(), 'p1', 'terminal', { flavourId: 'cmd' } as never);
    const panel = panelOf(clearPanelType(l, 'p1'));
    expect(panel.kind).toBeUndefined();
    expect(panel.terminalMemory).toBeUndefined();
  });

  it('is a no-op for an unknown panel id', () => {
    const before = layout();
    expect(setTerminalMemory(before, 'nope', { startupCommand: 'x' })).toEqual(before);
  });

  it('does not mutate the input layout', () => {
    const before = layout();
    setTerminalMemory(before, 'p1', { startupCommand: 'npm run dev' });
    expect(panelOf(before).terminalMemory).toBeUndefined();
  });
});

/**
 * FR-002f requires migration tests from REAL pre-025 persisted data for both halves of the
 * rename. The settings half lives in app-settings.terminals.test.ts; this is the Panel-config
 * half — the one that decides whether an existing user's shell arguments survive the upgrade.
 */
describe('readTerminalPanelConfig migration (025 FR-002d/FR-002f)', () => {
  it('reads a pre-025 panel config, which spelled it `params`', () => {
    // Exactly the shape a Panel persisted before this feature: no shellArguments key at all.
    const legacy = { flavourId: 'cmd', flavourLabel: 'Command Prompt', params: '-NoLogo', runAsAdmin: false };
    expect(readTerminalPanelConfig(legacy)).toEqual({
      shellArguments: '-NoLogo',
      startupCommand: '',
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  it('prefers the new key when both are present, and is idempotent over migrated data', () => {
    const both = { params: '-OLD', shellArguments: '-NEW' };
    expect(readTerminalPanelConfig(both).shellArguments).toBe('-NEW');
    // Re-reading its own output never sees the old key (FR-002e).
    const once = readTerminalPanelConfig(both);
    expect(readTerminalPanelConfig({ ...once })).toEqual(once);
  });

  it('defaults an absent config rather than throwing — a panel with no config still launches', () => {
    expect(readTerminalPanelConfig(undefined)).toEqual({
      shellArguments: '',
      startupCommand: '',
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  it('treats a non-string value as absent rather than coercing it into a command line', () => {
    expect(readTerminalPanelConfig({ params: 42, startupCommand: null })).toEqual({
      shellArguments: '',
      startupCommand: '',
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  it('reads the new 025 fields, defaulting memory OFF (FR-015)', () => {
    expect(readTerminalPanelConfig({ shellArguments: '/K', startupCommand: 'npm run dev' })).toEqual({
      shellArguments: '/K',
      startupCommand: 'npm run dev',
      rememberCommand: false,
      rememberDirectory: true,
    });
    expect(readTerminalPanelConfig({ rememberCommand: true }).rememberCommand).toBe(true);
    // Only a real boolean true enables it — a truthy string must not.
    expect(readTerminalPanelConfig({ rememberCommand: 'yes' }).rememberCommand).toBe(false);
  });

  it('directory memory defaults ON, and only an explicit false turns it off (FR-027a)', () => {
    // A pre-025 panel, and one confirmed before this control existed, must both still remember.
    expect(readTerminalPanelConfig({ params: '-NoLogo' }).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({}).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({ rememberDirectory: false }).rememberDirectory).toBe(false);
    // A non-boolean must not accidentally switch it off.
    expect(readTerminalPanelConfig({ rememberDirectory: 'no' }).rememberDirectory).toBe(true);
  });
});
