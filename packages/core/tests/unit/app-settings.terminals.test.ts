import { describe, it, expect } from 'vitest';
import { parseAppSettings, parseSettingsGuarded, DEFAULT_APP_SETTINGS } from '@throng/core';

describe('parseAppSettings — terminals section (005 Phase B)', () => {
  it('defaults to empty flavours / disabledBuiltins / defaultShellArguments (+ showStatusBar on) when absent', () => {
    expect(parseAppSettings({}).terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultShellArguments: {},
      commandRecipes: {},
      commandPollMs: 1000,
      shellIntegration: true,
      showStatusBar: true,
      linkHoverDelayMs: 500,
      // 039 FR-002. `defaultRememberCommand` ships OFF, restoring 025 FR-015 — see the 039
      // supersession block and the dedicated describe at the foot of this file.
      defaultRememberCommand: false,
      defaultRememberDirectory: true,
      defaultRunAsAdmin: false,
      reloadMode: 'automatic',
    });
    expect(DEFAULT_APP_SETTINGS.terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultShellArguments: {},
      commandRecipes: {},
      commandPollMs: 1000,
      shellIntegration: true,
      showStatusBar: true,
      linkHoverDelayMs: 500,
      // 039 FR-002. `defaultRememberCommand` ships OFF, restoring 025 FR-015 — see the 039
      // supersession block and the dedicated describe at the foot of this file.
      defaultRememberCommand: false,
      defaultRememberDirectory: true,
      defaultRunAsAdmin: false,
      reloadMode: 'automatic',
    });
  });

  // 025 FR-002c/FR-002d: "Startup Params" became "Shell Arguments" all the way down to the
  // persisted keys, so a settings file written before this feature MUST still load its values.
  // These fixtures use the OLD spelling verbatim (FR-002f) — hand-built new-shape objects would
  // prove nothing about migration.
  describe('shell-arguments rename migration (025 FR-002d)', () => {
    it('reads a pre-025 terminals.defaultParams map into defaultShellArguments', () => {
      const parsed = parseAppSettings({ terminals: { defaultParams: { pwsh: '-NoLogo', cmd: '/K' } } });
      expect(parsed.terminals.defaultShellArguments).toEqual({ pwsh: '-NoLogo', cmd: '/K' });
    });

    it("reads a pre-025 flavour's defaultParams into defaultShellArguments", () => {
      const parsed = parseAppSettings({
        terminals: {
          flavours: [{ id: 'my-wsl', label: 'WSL', file: 'wsl.exe', args: [], defaultParams: '--cd ~' }],
        },
      });
      expect(parsed.terminals.flavours[0]?.defaultShellArguments).toBe('--cd ~');
    });

    it('prefers the new key when both are present, and is idempotent over already-migrated data', () => {
      const migrated = parseAppSettings({
        terminals: { defaultParams: { cmd: '/OLD' }, defaultShellArguments: { cmd: '/NEW' } },
      });
      expect(migrated.terminals.defaultShellArguments).toEqual({ cmd: '/NEW' });
      // Re-parsing the migrated output must be a no-op (FR-002e).
      expect(parseAppSettings({ terminals: migrated.terminals }).terminals.defaultShellArguments).toEqual({
        cmd: '/NEW',
      });
    });

    it('defaults commandRecipes to {} and commandPollMs to 1000 (FR-019c)', () => {
      expect(parseAppSettings({}).terminals.commandRecipes).toEqual({});
      expect(parseAppSettings({}).terminals.commandPollMs).toBe(1000);
    });

    it('parses a per-flavour commandRecipe (FR-011) and terminals.commandRecipes overrides', () => {
      const parsed = parseAppSettings({
        terminals: {
          flavours: [
            { id: 'my-cmd', label: 'My CMD', file: 'cmd.exe', args: [], commandRecipe: ['/K', '{command}'] },
          ],
          commandRecipes: { pwsh: ['-NoExit', '-Command', '{command}'] },
        },
      });
      expect(parsed.terminals.flavours[0]?.commandRecipe).toEqual(['/K', '{command}']);
      expect(parsed.terminals.commandRecipes).toEqual({ pwsh: ['-NoExit', '-Command', '{command}'] });
    });
  });

  /*
   * 031 T033 (#227) — this test used to assert a clamp to [0, 5000] HERE, and that was the bug.
   *
   * The descriptor declared 0–2000 all along; the clamp accepted 0–5000; and because the clamp was
   * the only one of the two that ran on read, the declaration was decorative. The range now lives
   * in one place, so the assertion moves with it: `parseAppSettings` keeps TYPE tolerance and
   * rounding, and the guarded read path is what enforces the declared range.
   */
  it('parses terminals.linkHoverDelayMs tolerantly (024 US7; default 500, round, reject non-number)', () => {
    expect(parseAppSettings({}).terminals.linkHoverDelayMs).toBe(500);
    expect(parseAppSettings({ terminals: { linkHoverDelayMs: 0 } }).terminals.linkHoverDelayMs).toBe(0);
    expect(parseAppSettings({ terminals: { linkHoverDelayMs: 750.4 } }).terminals.linkHoverDelayMs).toBe(750);
    expect(parseAppSettings({ terminals: { linkHoverDelayMs: 'soon' } }).terminals.linkHoverDelayMs).toBe(500);
  });

  it('bounds terminals.linkHoverDelayMs at its DECLARED 0–2000 on the guarded read path (031, FR-015)', () => {
    expect(parseSettingsGuarded({ terminals: { linkHoverDelayMs: -20 } }).value.terminals.linkHoverDelayMs).toBe(0);
    expect(parseSettingsGuarded({ terminals: { linkHoverDelayMs: 99999 } }).value.terminals.linkHoverDelayMs).toBe(2000);
  });

  it('parses terminals.showStatusBar (024 US1; default true, honour false, reject non-boolean)', () => {
    expect(parseAppSettings({}).terminals.showStatusBar).toBe(true);
    expect(parseAppSettings({ terminals: { showStatusBar: false } }).terminals.showStatusBar).toBe(false);
    expect(parseAppSettings({ terminals: { showStatusBar: 'no' } }).terminals.showStatusBar).toBe(true);
  });

  it('keeps a well-formed user flavour entry', () => {
    const parsed = parseAppSettings({
      terminals: {
        flavours: [
          { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultShellArguments: '' },
        ],
        disabledBuiltins: ['cmd'],
        defaultShellArguments: { pwsh: '-NoLogo' },
      },
    });
    expect(parsed.terminals.flavours).toEqual([
      { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultShellArguments: '' },
    ]);
    expect(parsed.terminals.disabledBuiltins).toEqual(['cmd']);
    expect(parsed.terminals.defaultShellArguments).toEqual({ pwsh: '-NoLogo' });
  });

  it('drops malformed flavour entries (missing id or file) but keeps the rest', () => {
    const parsed = parseAppSettings({
      terminals: {
        flavours: [
          { id: 'good', label: 'Good', file: 'good.exe' },
          { label: 'No id', file: 'x.exe' },
          { id: 'no-file', label: 'No file' },
          'nonsense',
        ],
      },
    });
    expect(parsed.terminals.flavours.map((f) => f.id)).toEqual(['good']);
    // a missing label falls back to the id; missing args default to [].
    expect(parsed.terminals.flavours[0]).toMatchObject({ id: 'good', file: 'good.exe', args: [] });
  });

  it('drops non-string disabledBuiltins and non-string defaultShellArguments values', () => {
    const parsed = parseAppSettings({
      terminals: {
        disabledBuiltins: ['cmd', 5, null],
        defaultShellArguments: { pwsh: '-NoLogo', bad: 7 },
      },
    });
    expect(parsed.terminals.disabledBuiltins).toEqual(['cmd']);
    expect(parsed.terminals.defaultShellArguments).toEqual({ pwsh: '-NoLogo' });
  });

  it('falls back to defaults when terminals is not an object', () => {
    expect(parseAppSettings({ terminals: 'nope' }).terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultShellArguments: {},
      commandRecipes: {},
      commandPollMs: 1000,
      shellIntegration: true,
      showStatusBar: true,
      linkHoverDelayMs: 500,
      // 039 FR-002. `defaultRememberCommand` ships OFF, restoring 025 FR-015 — see the 039
      // supersession block and the dedicated describe at the foot of this file.
      defaultRememberCommand: false,
      defaultRememberDirectory: true,
      defaultRunAsAdmin: false,
      reloadMode: 'automatic',
    });
  });
});

/*
 * 039 (#293, #223) — the four settings this feature adds to the Terminal group.
 *
 * The interesting one is `defaultRememberCommand`, and the reason is worth having next to the
 * assertions rather than in a commit message. 025 FR-015 requires command memory to be OPT-IN and
 * to default OFF, and 025 FR-047a permits a captured command to re-run on the next cold start with
 * no prompt PRECISELY BECAUSE that safeguard is in force. The code shipped the opposite — absent
 * meant on, at panel-type.ts:85 — so for two releases FR-047a's argument rested on something that
 * was not true. 039 restores FR-015 rather than superseding it; what 039 supersedes is the
 * undocumented code-level default.
 *
 * `defaultRememberDirectory` ships ON and that is NOT the same drift: 025 FR-027b really does say
 * absent-means-on for the DIRECTORY, and it stays. The two fields differ deliberately — a
 * remembered directory cannot execute anything, and a remembered command can.
 */
describe('parseAppSettings — terminals section (039: reload mode and New Panel defaults)', () => {
  it('ships defaultRememberCommand OFF, restoring 025 FR-015 (039 FR-002)', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.defaultRememberCommand).toBe(false);
    expect(parseAppSettings({}).terminals.defaultRememberCommand).toBe(false);
  });

  it('ships defaultRememberDirectory ON, unchanged from 025 FR-027b (039 FR-002)', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.defaultRememberDirectory).toBe(true);
  });

  it('ships defaultRunAsAdmin OFF (039 FR-002)', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.defaultRunAsAdmin).toBe(false);
  });

  it("ships reloadMode 'automatic' — today's behaviour is the default (039 FR-020)", () => {
    expect(DEFAULT_APP_SETTINGS.terminals.reloadMode).toBe('automatic');
  });

  it('reads reloadMode: manual (039 FR-020)', () => {
    expect(parseAppSettings({ terminals: { reloadMode: 'manual' } }).terminals.reloadMode).toBe('manual');
  });

  // The parser falls back PER FIELD, so a config that sets one setting must not reset the other
  // three to their shipped values by omission.
  it('falls back per field — setting one does not disturb the others (039 FR-002)', () => {
    const t = parseAppSettings({ terminals: { defaultRememberCommand: true } }).terminals;
    expect(t.defaultRememberCommand).toBe(true);
    expect(t.defaultRememberDirectory).toBe(true);
    expect(t.defaultRunAsAdmin).toBe(false);
    expect(t.reloadMode).toBe('automatic');
    // …and the pre-existing terminal settings are still there, which is the failure mode a
    // hand-written section parser actually has.
    expect(t.shellIntegration).toBe(true);
    expect(t.commandPollMs).toBe(1000);
  });

  it('falls back rather than throwing on a wrong type (039 FR-002)', () => {
    const t = parseAppSettings({
      terminals: { defaultRememberCommand: 'yes', defaultRunAsAdmin: 1, reloadMode: 'sideways' },
    }).terminals;
    expect(t.defaultRememberCommand).toBe(false);
    expect(t.defaultRunAsAdmin).toBe(false);
    expect(t.reloadMode).toBe('automatic');
  });

  /*
   * A field absent from `cloneTerminals` is dropped on a settings WRITE — a whole class of defect
   * spec 032 exists about, and one that no assertion about parsing would catch. `parseAppSettings({})`
   * goes through the clone, so a dropped field surfaces as `undefined` here.
   */
  it('survives the defensive copy — no field is dropped on a write (032, 039 FR-002)', () => {
    const t = parseAppSettings({}).terminals;
    for (const key of [
      'defaultRememberCommand',
      'defaultRememberDirectory',
      'defaultRunAsAdmin',
      'reloadMode',
    ] as const) {
      expect(t[key], `${key} was dropped by cloneTerminals`).toBeDefined();
    }
  });
});
