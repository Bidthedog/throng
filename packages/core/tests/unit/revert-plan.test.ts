/**
 * 032 T020b / FR-001a — Revert All reverts what it CAPTURED, not the whole settings file.
 *
 * The load-bearing test is `leaves main-window state alone`. Everything else here defends the
 * definition of the key set, and the key set is derived from `SETTINGS_METADATA` rather than listed,
 * so a setting added tomorrow is covered without anyone editing this file.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_INTERNAL_KEYS,
  getAtPath,
  planRevertAll,
  type OnEntrySnapshot,
} from '../../src/index.js';

function snapshotOf(settings: unknown, extra: Partial<OnEntrySnapshot> = {}): OnEntrySnapshot {
  return {
    settings: JSON.stringify(settings),
    keybindings: '{"bindings":{}}',
    themes: {},
    activeTheme: 'throng',
    ...extra,
  };
}

/** The change for a dotted key, or undefined if the plan does not carry one. */
function changeFor(
  plan: ReturnType<typeof planRevertAll>,
  key: string,
): { path: readonly string[]; value: unknown } | undefined {
  return plan.settingsChanges.find((c) => c.path.join('.') === key);
}

describe('planRevertAll — the settings half', () => {
  it('leaves main-window state alone', () => {
    // The whole reason FR-001a exists. `newProject.lastProjectFolder` is written by the PROJECT
    // LIST, in the other window, while Preferences is open — so reverting it discards a folder the
    // user chose after opening Preferences, which nothing warned them about.
    const plan = planRevertAll(snapshotOf({ ...DEFAULT_APP_SETTINGS }));
    expect(changeFor(plan, 'newProject.lastProjectFolder')).toBeUndefined();
  });

  it('carries no internal key at all', () => {
    const plan = planRevertAll(snapshotOf({ ...DEFAULT_APP_SETTINGS }));
    const keys = plan.settingsChanges.map((c) => c.path.join('.'));
    for (const internal of SETTINGS_INTERNAL_KEYS) {
      expect(keys).not.toContain(internal);
    }
  });

  it('restores a captured value the user has since changed', () => {
    const captured = structuredClone(DEFAULT_APP_SETTINGS);
    captured.appearance.theme = 'Matrix';
    const plan = planRevertAll(snapshotOf(captured));
    expect(changeFor(plan, 'appearance.theme')?.value).toBe('Matrix');
  });

  it('resets a descriptor-carrying key absent at snapshot time to its shipped default', () => {
    // Decided rather than assumed (T020b(b)): the window opened SHOWING the shipped default for a
    // key its document omitted, because that is what the app runs on. Reverting to how the window
    // opened therefore means the shipped default.
    const captured = structuredClone(DEFAULT_APP_SETTINGS) as Record<string, unknown>;
    delete (captured.appearance as Record<string, unknown>).theme;
    const plan = planRevertAll(snapshotOf(captured));
    expect(changeFor(plan, 'appearance.theme')?.value).toBe(
      getAtPath(DEFAULT_APP_SETTINGS, 'appearance.theme'),
    );
  });

  it('covers every descriptor-carrying leaf, derived not listed', () => {
    const plan = planRevertAll(snapshotOf({ ...DEFAULT_APP_SETTINGS }));
    expect(plan.settingsChanges.length).toBeGreaterThan(10);
    // Every change addresses a real path in the shipped defaults, so none is a typo that would
    // write a key nothing reads.
    for (const change of plan.settingsChanges) {
      expect(getAtPath(DEFAULT_APP_SETTINGS, change.path.join('.'))).toBeDefined();
    }
  });

  /*
   * 044 plan decision 3 (FR-122e with 032 FR-001a) — a PIN, not a new behaviour.
   *
   * Scroll sync can now be toggled from an editor or a preview while Preferences is open. The key
   * carries a descriptor, the open Preferences window shows the toggle's new value, and so Revert All
   * reverts it with every other preference — unlike the project list's folder, which is not a
   * preference at all. The plan is built from the snapshot alone; the document on disk has since
   * moved on (sync switched off, a different folder chosen), and neither fact is an input.
   *
   * Pinned so that excluding the key later is a visible decision rather than drift. Observed failing
   * against a deliberate break (the key filtered out of `planRevertAll`), then passing once reverted.
   */
  it('restores a scroll-sync toggle made outside Preferences, and still leaves the project folder alone', () => {
    const captured = structuredClone(DEFAULT_APP_SETTINGS);
    captured.editor.previews.syncScroll = true;
    captured.newProject.lastProjectFolder = 'D:/captured';
    // What the file holds by the time Revert All is pressed — shown for the reader, not an input.
    const current = structuredClone(captured);
    current.editor.previews.syncScroll = false;
    current.newProject.lastProjectFolder = 'D:/chosen-later';

    const plan = planRevertAll(snapshotOf(captured));

    expect(changeFor(plan, 'editor.previews.syncScroll')).toEqual({
      path: ['editor', 'previews', 'syncScroll'],
      value: true,
    });
    expect(changeFor(plan, 'editor.previews.syncScroll')?.value).not.toBe(current.editor.previews.syncScroll);
    expect(changeFor(plan, 'newProject.lastProjectFolder')).toBeUndefined();
  });

  it('writes NOTHING to settings when the captured document cannot be parsed', () => {
    // The snapshot is the only record of what to revert TO. Without it there is no target, and
    // inventing one — the defaults, an empty document — would revert further than the user asked.
    const plan = planRevertAll({
      settings: '{ this is not json',
      keybindings: '{"bindings":{}}',
      themes: {},
      activeTheme: 'throng',
    });
    expect(plan.settingsChanges).toEqual([]);
  });
});

describe('planRevertAll — the document half', () => {
  it('restores keybindings and themes verbatim, and never settings', () => {
    const plan = planRevertAll(
      snapshotOf({ ...DEFAULT_APP_SETTINGS }, { themes: { Matrix: '{"name":"Matrix"}' } }),
    );
    const kinds = plan.documents.map((d) => d.id.kind);
    expect(kinds).toContain('keybindings');
    expect(kinds).toContain('theme');
    // `writePatch` refuses anything but settings, so a settings entry here would be written twice —
    // once as a patch set and once wholesale, with the wholesale one reverting the main-window key
    // the patch set deliberately left alone.
    expect(kinds).not.toContain('settings');
  });

  it('restores the captured theme document byte for byte', () => {
    const plan = planRevertAll(
      snapshotOf({ ...DEFAULT_APP_SETTINGS }, { themes: { Matrix: '{"name":"Matrix","x":1}' } }),
    );
    const theme = plan.documents.find((d) => d.id.kind === 'theme');
    expect(theme?.json).toBe('{"name":"Matrix","x":1}');
  });
});
