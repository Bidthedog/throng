import { describe, it, expect } from 'vitest';
import {
  terminalPanelType,
  type FlavourOption,
  type PanelTypeContext,
} from '@throng/core';

const FLAVOURS: FlavourOption[] = [
  { value: 'pwsh', label: 'PowerShell 7', defaultShellArguments: '-NoLogo' },
  { value: 'bash', label: 'Git Bash', defaultShellArguments: '-i -l' },
];

function ctx(overrides: Partial<PanelTypeContext> = {}): PanelTypeContext {
  return { projectRoot: 'C:/proj', flavours: FLAVOURS, ...overrides };
}

describe('Terminal descriptor — metadata', () => {
  it('declares the Flavour dropdown, Shell Arguments, Startup Command and memory inputs', () => {
    expect(terminalPanelType.id).toBe('terminal');
    expect(terminalPanelType.label).toBe('Terminal');
    const keys = terminalPanelType.inputs.map((i) => i.key);
    expect(keys).toEqual([
      'flavourId',
      'shellArguments',
      'startupCommand',
      'rememberCommand',
      'rememberDirectory',
    ]);
    const flavour = terminalPanelType.inputs.find((i) => i.key === 'flavourId')!;
    expect(flavour.control).toBe('dropdown');
    expect(flavour.options!(ctx())).toEqual([
      { value: 'pwsh', label: 'PowerShell 7' },
      { value: 'bash', label: 'Git Bash' },
    ]);
  });
});

describe('Terminal descriptor — defaults', () => {
  /*
   * 039 FR-004. `rememberCommand` reads 'false' here, where it read 'true' before.
   *
   * These contexts carry no `terminalDefaults`, so the descriptor falls back to
   * SHIPPED_TERMINAL_PANEL_DEFAULTS — deliberately the SHIPPED values rather than the old
   * literals, so a call site that forgets to pass the preferences still gets the correct default
   * instead of quietly reinstating the behaviour 039 exists to fix. Shipped off is 025 FR-015.
   */
  it('seeds the first flavour and its default shell arguments', () => {
    expect(terminalPanelType.defaults(ctx())).toEqual({
      flavourId: 'pwsh',
      shellArguments: '-NoLogo',
      startupCommand: '',
      rememberCommand: 'false',
      rememberDirectory: 'true',
      runAsAdmin: 'false',
    });
  });

  it('seeds empty values when no flavours are available', () => {
    expect(terminalPanelType.defaults(ctx({ flavours: [] }))).toEqual({
      flavourId: '',
      shellArguments: '',
      startupCommand: '',
      rememberCommand: 'false',
      rememberDirectory: 'true',
      runAsAdmin: 'false',
    });
  });
});

/*
 * 039 FR-004/FR-005 (#223) — the three New Panel checkboxes seed from Preferences → Terminal.
 *
 * The precedence being asserted, highest first:
 *   1. what the Panel REMEMBERED     (025 FR-007a — the empty state is the edit screen)
 *   2. the global preference          (039 FR-004 — new)
 *   3. nothing
 *
 * Step 2 used to be a hard-coded literal, which is the whole of #223.
 */
describe('Terminal descriptor — defaults seed from the preferences (039 FR-004)', () => {
  const ALL_ON = { rememberCommand: true, rememberDirectory: true, runAsAdmin: true };
  const ALL_OFF = { rememberCommand: false, rememberDirectory: false, runAsAdmin: false };

  it('takes each checkbox from the preference when the Panel has no memory', () => {
    // `daemonElevated` because `runAsAdmin` is now gated on it (FR-008a, asserted below). This
    // test is about the OTHER rule — that each seed comes from the preference — so it is stated
    // on a machine where all three preferences can actually be honoured.
    const on = terminalPanelType.defaults(ctx({ terminalDefaults: ALL_ON, daemonElevated: true }));
    expect(on.rememberCommand).toBe('true');
    expect(on.rememberDirectory).toBe('true');
    expect(on.runAsAdmin).toBe('true');

    const off = terminalPanelType.defaults(ctx({ terminalDefaults: ALL_OFF, daemonElevated: true }));
    expect(off.rememberCommand).toBe('false');
    expect(off.rememberDirectory).toBe('false');
    expect(off.runAsAdmin).toBe('false');
  });

  /*
   * 039 FR-008a — the SEED half of the elevation gate.
   *
   * A preference is a seed. `canRunAsAdmin()` is the gate, and a seed may not out-rank it. This
   * matters more than it looks: `buildConfig` writes the seeded value into the Panel's PERSISTED
   * config, and nothing rewrites it afterwards — so an ungated seed does not merely mislabel
   * today's unelevated terminal, it plants a `runAsAdmin: true` that opens that panel's shell as
   * administrator the next time throng is launched elevated, from a box the user could never tick.
   *
   * Note what is NOT gated: the other two seeds are untouched by elevation, so a red here can only
   * be about the admin flag rather than about the seeding mechanism in general.
   */
  it('never seeds runAsAdmin ON when the daemon is not elevated (FR-008a)', () => {
    const unelevated = terminalPanelType.defaults(ctx({ terminalDefaults: ALL_ON }));
    expect(unelevated.runAsAdmin).toBe('false');
    expect(unelevated.rememberCommand).toBe('true');
    expect(unelevated.rememberDirectory).toBe('true');

    // Explicit `false` reads the same as absent: a context that cannot establish elevation must
    // not seed an elevation request, and `useCapabilities` reports exactly this until the daemon
    // answers.
    expect(
      terminalPanelType.defaults(ctx({ terminalDefaults: ALL_ON, daemonElevated: false })).runAsAdmin,
    ).toBe('false');

    // And the gate does not invent one either — elevated plus a preference of OFF is still off.
    expect(
      terminalPanelType.defaults(ctx({ terminalDefaults: ALL_OFF, daemonElevated: true })).runAsAdmin,
    ).toBe('false');
  });

  it("what the Panel remembered still WINS over the preference (FR-005, 025 FR-007a)", () => {
    // Preferences say on; this Panel was explicitly switched off. The Panel wins, in both
    // directions — a preference is a seed and a fallback, never an override.
    const seeded = terminalPanelType.defaults(
      ctx({ terminalDefaults: ALL_ON, terminalMemory: { rememberCommand: false } }),
    );
    expect(seeded.rememberCommand).toBe('false');
    // …and the field it said nothing about still takes the preference.
    expect(seeded.rememberDirectory).toBe('true');

    const opposite = terminalPanelType.defaults(
      ctx({ terminalDefaults: ALL_OFF, terminalMemory: { rememberCommand: true } }),
    );
    expect(opposite.rememberCommand).toBe('true');
  });

  // FR-003: one set of defaults for every flavour. Flavours own shell arguments and recipes, not
  // these three, and a per-flavour path here would be a bug rather than a feature.
  it('seeds identically for every flavour (FR-003)', () => {
    // Elevated on both sides, so all three seeds are genuinely ON and the comparison has
    // something to distinguish. Under FR-008a an unelevated pair would agree on `runAsAdmin` by
    // both being off, which is agreement the parity claim should not be resting on.
    const pwsh = terminalPanelType.defaults(ctx({ terminalDefaults: ALL_ON, daemonElevated: true }));
    const bash = terminalPanelType.defaults(
      ctx({ terminalDefaults: ALL_ON, daemonElevated: true, flavours: [FLAVOURS[1]!, FLAVOURS[0]!] }),
    );
    expect(bash.flavourId).toBe('bash'); // proves the two really are different flavours
    for (const key of ['rememberCommand', 'rememberDirectory', 'runAsAdmin'] as const) {
      expect(bash[key], `${key} differed between flavours`).toBe(pwsh[key]);
    }
  });
});

describe('Terminal descriptor — validate (gates Confirm, FR-005)', () => {
  it('is ok for a known flavour with an active project root', () => {
    expect(terminalPanelType.validate({ flavourId: 'pwsh', shellArguments: '-NoLogo' }, ctx())).toEqual({
      ok: true,
    });
  });

  it('rejects when no flavour is selected', () => {
    const r = terminalPanelType.validate({ flavourId: '', shellArguments: '' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });

  it('rejects an unknown/unavailable flavour (FR-019 restore edge)', () => {
    const r = terminalPanelType.validate({ flavourId: 'ghost', shellArguments: '' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });

  it('rejects when there is no active project root (no-project edge)', () => {
    const r = terminalPanelType.validate({ flavourId: 'pwsh', shellArguments: '-NoLogo' }, ctx({ projectRoot: null }));
    expect(r.ok).toBe(false);
  });

  it('is ok with a null root when the Panel is rootless (sub-workspace-owned → home dir)', () => {
    // A Panel created inside a sub-workspace has no owning project; its terminal
    // launches at the user's default home directory, so a null root is allowed
    // when `rootless` is set (FR-028).
    const r = terminalPanelType.validate(
      { flavourId: 'pwsh', shellArguments: '-NoLogo' },
      ctx({ projectRoot: null, rootless: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('still requires a chosen flavour even when rootless', () => {
    const r = terminalPanelType.validate(
      { flavourId: '', shellArguments: '' },
      ctx({ projectRoot: null, rootless: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });
});

describe('Terminal descriptor — buildConfig', () => {
  it('captures the chosen flavour, shell arguments, startup command and memory flag', () => {
    expect(
      terminalPanelType.buildConfig(
        { flavourId: 'pwsh', shellArguments: '-NoLogo -X', startupCommand: 'npm run dev', rememberCommand: 'true', rememberDirectory: 'true', runAsAdmin: 'false' },
        ctx(),
      ),
    ).toEqual({
      flavourId: 'pwsh',
      flavourLabel: 'PowerShell 7',
      shellArguments: '-NoLogo -X',
      startupCommand: 'npm run dev',
      rememberCommand: true,
      rememberDirectory: true,
      runAsAdmin: false,
    });
  });
});
