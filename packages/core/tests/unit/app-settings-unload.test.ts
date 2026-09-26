import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { applyConfigPatch } from '../../src/config/config-patch.js';
import { parseSettingsGuarded } from '../../src/config/settings-read.js';
import { isSettingsTextValid } from '../../src/config/settings-validity.js';

/**
 * 046 US4 — the Unload settings after FR-111 (T125).
 *
 * `projects.unloadTerminalAction` (FR-034a) is unchanged: a top-level `projects` section, not nested
 * under `panes.projects` (pane geometry, not project behaviour), defaulting to `keepRunning`.
 *
 * `confirmations.unloadProject` (FR-034b) is WITHDRAWN: no Unload row prompts any more, so a level
 * governing that prompt changes nothing, and a preference that changes nothing misleads whoever sets
 * it (FR-111, Principle VIII). It leaves the type, the default, the parse and the clone.
 *
 * ══ WHAT HAPPENS TO A VALUE ALREADY SAVED ══
 *
 * FR-111 and contracts/unload.md §6 say a saved value "is left in the file as an unmodelled key, which
 * the write path preserves". The first half holds: nothing rewrites the file to remove it, and the
 * document stays valid, so nobody is blocked in the JSON editor over it. The second half does NOT —
 * and must not be written as a test, because it contradicts shipped, tested behaviour: every settings
 * write normalises through `parseSettingsGuarded`, which drops a key the schema does not model
 * (`packages/ui/src/main/config-write-ipc.ts:156-180`, `config-write-patch.contract.test.ts:183-195`,
 * `preferences-settings.e2e.ts:376-380`). So the stale key survives READS and is dropped by the NEXT
 * ORDINARY WRITE — which is harmless, because 046 never shipped and the key only ever existed in a
 * development `settings.json`. The last test below pins that, in line with the shipped rule.
 */
describe('projects.unloadTerminalAction (046 US4, FR-034a) — unchanged', () => {
  it('defaults to keepRunning', () => {
    expect(DEFAULT_APP_SETTINGS.projects.unloadTerminalAction).toBe('keepRunning');
  });

  it('parses a well-formed value', () => {
    expect(parseAppSettings({ projects: { unloadTerminalAction: 'endTerminals' } }).projects.unloadTerminalAction).toBe(
      'endTerminals',
    );
  });

  it('falls back to the default for an unknown value', () => {
    const parsed = parseAppSettings({ projects: { unloadTerminalAction: 'nonsense' } });
    expect(parsed.projects.unloadTerminalAction).toBe('keepRunning');
  });

  it('uses defaults when the projects section is missing or not an object', () => {
    expect(parseAppSettings({}).projects.unloadTerminalAction).toBe('keepRunning');
    expect(parseAppSettings({ projects: 'x' }).projects.unloadTerminalAction).toBe('keepRunning');
  });

  it('clone keeps it independent of the shipped defaults', () => {
    const parsed = parseAppSettings({});
    parsed.projects.unloadTerminalAction = 'endTerminals';
    expect(DEFAULT_APP_SETTINGS.projects.unloadTerminalAction).toBe('keepRunning');
  });

  it('clone keeps it independent across two parses', () => {
    const a = parseAppSettings({ projects: { unloadTerminalAction: 'endTerminals' } });
    const b = parseAppSettings({});
    a.projects.unloadTerminalAction = 'keepRunning';
    expect(b.projects.unloadTerminalAction).toBe('keepRunning');
  });
});

describe('confirmations.unloadProject is withdrawn (046 FR-111)', () => {
  it('is not in the shipped defaults', () => {
    expect(DEFAULT_APP_SETTINGS.confirmations).not.toHaveProperty('unloadProject');
  });

  it('is not modelled by the parse, whatever value a file carries', () => {
    for (const value of ['none', 'single', 'double', 'nonsense']) {
      const parsed = parseAppSettings({ confirmations: { unloadProject: value } });
      expect(parsed.confirmations, `unloadProject: ${value}`).not.toHaveProperty('unloadProject');
    }
  });

  it('a saved value costs the rest of the section nothing — the other confirmation levels still parse', () => {
    const parsed = parseAppSettings({
      confirmations: { unloadProject: 'single', destroyProject: 'none', destroyTab: 'single' },
    });
    expect(parsed.confirmations.destroyProject).toBe('none');
    expect(parsed.confirmations.destroyTab).toBe('single');
  });

  it('a document still carrying it is VALID, so a developer who set it is never held in the JSON editor', () => {
    const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
    doc.confirmations!.unloadProject = 'double';
    expect(isSettingsTextValid(JSON.stringify(doc))).toBe(true);
  });

  it('is dropped by the next ordinary write, like every other unmodelled key (019 FR-023; config-write-ipc.ts)', () => {
    // The write path, as `writeConfigPatch` runs it: patch the raw document, then normalise through
    // the guarded parse. The patch touches a DIFFERENT key, as a Preferences edit would.
    const onDisk = {
      confirmations: { destroyProject: 'single', unloadProject: 'double' },
      projects: { unloadTerminalAction: 'keepRunning' },
    };
    const patched = applyConfigPatch(onDisk, [{ path: ['projects', 'unloadTerminalAction'], value: 'endTerminals' }]);
    if (!patched.ok) throw new Error(`patch refused: ${patched.error}`);
    // The patch itself leaves the stale key alone — only the normalisation removes it.
    expect((patched.value.confirmations as Record<string, unknown>).unloadProject).toBe('double');

    const written = parseSettingsGuarded(patched.value).value;
    expect(written.projects.unloadTerminalAction).toBe('endTerminals');
    expect(written.confirmations.destroyProject).toBe('single');
    expect(written.confirmations).not.toHaveProperty('unloadProject');
  });
});
