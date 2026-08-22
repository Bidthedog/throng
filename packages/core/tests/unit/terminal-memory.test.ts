import { describe, it, expect } from 'vitest';
import {
  clearPanelType,
  readTerminalPanelConfig,
  setPanelType,
  setTerminalMemory,
} from '@throng/core';
import type { WorkspaceLayout } from '@throng/core';

/*
 * 039 FR-005a — `readTerminalPanelConfig` now takes the global preferences, because an ABSENT
 * per-Panel value resolves to them rather than to a hard-coded literal.
 *
 * `SHIPPED` is what a clean config gives you. Note `rememberCommand: false`: that is 025 FR-015
 * ("a per-Panel OPT-IN control … MUST default to off") being honoured again after two releases in
 * which the code shipped the opposite. Several assertions below therefore changed from `true` to
 * `false`, and they changed BECAUSE THE SPEC SAYS WHY — see 039's Supersessions block. They are the
 * record of the behaviour that moved, not collateral damage from a refactor.
 */
const SHIPPED = { rememberCommand: false, rememberDirectory: true, runAsAdmin: false } as const;

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
    expect(readTerminalPanelConfig(legacy, SHIPPED)).toEqual({
      shellArguments: '-NoLogo',
      startupCommand: '',
      // 039 FR-005a: no rememberCommand key, so this takes the PREFERENCE. SHIPPED ships it off,
      // which is 025 FR-015 back in force. It read `true` before, from a hard-coded literal.
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  it('prefers the new key when both are present, and is idempotent over migrated data', () => {
    const both = { params: '-OLD', shellArguments: '-NEW' };
    expect(readTerminalPanelConfig(both, SHIPPED).shellArguments).toBe('-NEW');
    // Re-reading its own output never sees the old key (FR-002e).
    const once = readTerminalPanelConfig(both, SHIPPED);
    expect(readTerminalPanelConfig({ ...once }, SHIPPED)).toEqual(once);
  });

  it('defaults an absent config rather than throwing — a panel with no config still launches', () => {
    expect(readTerminalPanelConfig(undefined, SHIPPED)).toEqual({
      shellArguments: '',
      startupCommand: '',
      // 039 FR-005a: no rememberCommand key, so this takes the PREFERENCE. SHIPPED ships it off,
      // which is 025 FR-015 back in force. It read `true` before, from a hard-coded literal.
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  it('treats a non-string value as absent rather than coercing it into a command line', () => {
    expect(readTerminalPanelConfig({ params: 42, startupCommand: null }, SHIPPED)).toEqual({
      shellArguments: '',
      startupCommand: '',
      // 039 FR-005a: no rememberCommand key, so this takes the PREFERENCE. SHIPPED ships it off,
      // which is 025 FR-015 back in force. It read `true` before, from a hard-coded literal.
      rememberCommand: false,
      rememberDirectory: true,
    });
  });

  /*
   * Retitled and re-pointed by 039. It used to read "defaulting BOTH memories ON", which was true
   * of the code and false of 025 FR-015. The DIRECTORY still defaults on (025 FR-027b, unchanged);
   * the COMMAND now follows the preference, which ships off.
   */
  it('reads the new 025 fields: directory defaults ON, command follows the preference', () => {
    expect(readTerminalPanelConfig({ shellArguments: '/K', startupCommand: 'npm run dev' }, SHIPPED)).toEqual({
      shellArguments: '/K',
      startupCommand: 'npm run dev',
      rememberCommand: false,
      rememberDirectory: true,
    });
    // An explicit value is the Panel's own answer and still wins, in both directions (FR-005).
    expect(readTerminalPanelConfig({ rememberCommand: true }, SHIPPED).rememberCommand).toBe(true);
    expect(readTerminalPanelConfig({ rememberCommand: false }, SHIPPED).rememberCommand).toBe(false);
    // A non-boolean is not an explicit value. It used to resolve to `true` via a `!== false` test;
    // it now falls through to the preference like any other absent value.
    expect(readTerminalPanelConfig({ rememberCommand: 'no' }, SHIPPED).rememberCommand).toBe(false);
  });

  it('directory memory defaults ON, and only an explicit false turns it off (FR-027a)', () => {
    // A pre-025 panel, and one confirmed before this control existed, must both still remember.
    expect(readTerminalPanelConfig({ params: '-NoLogo' }, SHIPPED).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({}, SHIPPED).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({ rememberDirectory: false }, SHIPPED).rememberDirectory).toBe(false);
    // A non-boolean must not accidentally switch it off.
    expect(readTerminalPanelConfig({ rememberDirectory: 'no' }, SHIPPED).rememberDirectory).toBe(true);
  });
});

/*
 * 039 FR-005a (#223) — an ABSENT per-Panel value resolves to the GLOBAL PREFERENCE.
 *
 * This is the one part of 039 that changes behaviour for an existing install, so it is worth being
 * exact about what moved and what did not:
 *
 *   persisted value   before            after
 *   ---------------   ---------------   -----------------------------
 *   true              true              true          (unchanged)
 *   false             false             false         (unchanged)
 *   absent            true  (literal)   the preference (ships false)
 *
 * Only `rememberCommand`'s absent case is observably different, because only its shipped default
 * moved. An absent value is NOT something the Panel remembered, so FR-005's "the Panel's own value
 * wins" never applied to it — it was falling through to a hard-coded literal, and that literal is
 * where the drift from 025 FR-015 lived.
 *
 * The `defaults` parameter is REQUIRED rather than optional on purpose. The question "where do
 * these defaults come from?" is exactly the one that went unanswered for two releases, and an
 * optional parameter lets a call site not answer it.
 */
describe('readTerminalPanelConfig — absent values resolve to the preferences (039 FR-005a)', () => {
  /** A user who has turned command memory back on globally. `SHIPPED` is module-scoped above. */
  const COMMAND_ON = { rememberCommand: true, rememberDirectory: true, runAsAdmin: false } as const;

  it('an absent rememberCommand takes the preference, not a literal', () => {
    expect(readTerminalPanelConfig({}, SHIPPED).rememberCommand).toBe(false);
    expect(readTerminalPanelConfig({}, COMMAND_ON).rememberCommand).toBe(true);
  });

  it("an explicit per-Panel value still wins over the preference (FR-005)", () => {
    // The Panel said so. The preference is the seed and the fallback, never an override.
    expect(readTerminalPanelConfig({ rememberCommand: true }, SHIPPED).rememberCommand).toBe(true);
    expect(readTerminalPanelConfig({ rememberCommand: false }, COMMAND_ON).rememberCommand).toBe(false);
  });

  it('a non-boolean is not an explicit value, so it takes the preference too', () => {
    // Previously `'no'` resolved to `true` via `!== false`. It is not a value the Panel ever
    // legitimately held, so it is absent by another name and follows the same rule.
    expect(readTerminalPanelConfig({ rememberCommand: 'no' }, SHIPPED).rememberCommand).toBe(false);
    expect(readTerminalPanelConfig({ rememberCommand: 'no' }, COMMAND_ON).rememberCommand).toBe(true);
  });

  it('the directory follows the same rule, with no observable change (025 FR-027b intact)', () => {
    // Shipped ON, as 025 FR-027b requires, so a pre-025 Panel keeps remembering exactly as before.
    expect(readTerminalPanelConfig({}, SHIPPED).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({ params: '-NoLogo' }, SHIPPED).rememberDirectory).toBe(true);
    expect(readTerminalPanelConfig({ rememberDirectory: false }, SHIPPED).rememberDirectory).toBe(false);
  });

  /*
   * T022 — the FR-047a safeguard, asserted rather than assumed.
   *
   * 025 FR-047a permits a captured command to re-run on the next cold start with NO prompt and no
   * distinction from a typed one. It names FR-015 — "memory is opt-in per Panel and defaults off" —
   * as one of exactly two safeguards that make that acceptable. For two releases that safeguard was
   * not in force. This asserts it is in force IN FACT, not merely required on paper.
   */
  it('FR-047a safeguard: on a clean config a fresh Panel does not remember commands', () => {
    expect(readTerminalPanelConfig({}, SHIPPED).rememberCommand).toBe(false);
  });
});
