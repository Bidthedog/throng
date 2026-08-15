/**
 * config-watcher — re-reads the user config when files under the config root
 * change and broadcasts the result to renderer windows for hot-reload (T034 /
 * research D3). Pure-ish: it owns no Electron references; `broadcast` is supplied
 * by main.ts so this stays unit-testable.
 */
import { existsSync } from 'node:fs';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  isValidThemeName,
  parseKeybindings,
  parseSettingsGuarded,
  THRONG_THEME,
  type AppSettings,
  type Disposable,
  type IConfigSettings,
  type IConfigStore,
  type IFileWatcher,
  type Keybindings,
  type LoadedIconPack,
  type Theme,
} from '@throng/core';

export interface ConfigPayload {
  settings: AppSettings;
  theme: Theme;
  keybindings: Keybindings;
  /**
   * 017 / #54 — icon packs ride the SAME channel as the theme, deliberately.
   *
   * A theme selects a pack (`theme.iconPack`). If packs arrived on a different channel, the two
   * would race, and there would be a frame in which the new theme is paired with the old pack's
   * icons. One payload, one render, no mismatch — which is also what makes a pack change LIVE
   * (FR-005) rather than merely eventual.
   */
  iconPacks: LoadedIconPack[];
}

/** A payload, plus whether the settings document could actually be read (032, FR-008). */
export interface ConfigReadResult {
  payload: ConfigPayload;
  /**
   * True iff `settings.json` EXISTS but could not be parsed, so `payload.settings` is the shipped
   * defaults rather than the user's choices.
   *
   * An absent document is not unreadable — a machine with no settings file yet is a normal machine,
   * and retrying would delay every first launch to no purpose.
   */
  settingsUnreadable: boolean;
}

/**
 * How hard the watcher tries again before it believes an unreadable document (032, FR-008).
 *
 * An INJECTED CONSTANT rather than an `AppSettings` key — and not because the completeness gate
 * forbids one (`SETTINGS_INTERNAL_KEYS` is a supported escape hatch, and
 * `newProject.lastProjectFolder` uses it). These are tuning constants for a race inside the
 * process: no user and no machine has a reason to want a different number, and a setting nobody
 * should change is a setting somebody eventually will.
 */
export interface ConfigWatchPolicy {
  /** Total read attempts, including the first. */
  attempts: number;
  /** Pause between attempts. */
  intervalMs: number;
}

/**
 * Three attempts, 50 ms apart.
 *
 * Sized against what it is waiting for: a writer that has truncated a file and not yet filled it,
 * or a scanner holding a handle. Both resolve in single-digit milliseconds, so 100 ms of total
 * patience is generous — while staying far inside FR-004's 100 ms freshness bound for the common
 * case, which does not retry at all.
 */
export const DEFAULT_CONFIG_WATCH_POLICY: ConfigWatchPolicy = { attempts: 3, intervalMs: 50 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read the active settings + the theme they select + keybindings + icon packs, merged over defaults. */
export async function readConfigPayload(
  store: IConfigStore,
  loadIconPacks: () => Promise<LoadedIconPack[]> = async () => [],
): Promise<ConfigPayload> {
  return (await readConfigOnce(store, loadIconPacks)).payload;
}

/**
 * One read of the whole configuration, reporting whether the settings document was usable.
 *
 * The readability question is answered from the RAW text rather than from `store.read`'s result,
 * because `store.read` cannot answer it: an absent document and an unparseable one both resolve to
 * `defaults`, and those two need opposite responses — one is a normal first launch, the other is a
 * file the user has that we just failed to read.
 */
export async function readConfigOnce(
  store: IConfigStore,
  loadIconPacks: () => Promise<LoadedIconPack[]> = async () => [],
): Promise<ConfigReadResult> {
  const rawSettings = await store.readRaw({ kind: 'settings' });
  let settingsUnreadable = false;
  if (rawSettings.trim().length === 0) {
    /*
     * EMPTY IS NOT ABSENT, and the difference is the whole point of this feature.
     *
     * `readRaw` returns `''` for both, because for the JSON editor — its original caller — they are
     * the same thing: an empty buffer to type into. Here they are opposites.
     *
     * A file that does not exist is a first run. Retrying it would delay every launch on a new
     * install to learn something that was never going to change.
     *
     * A file that EXISTS AND IS EMPTY is the single most likely state to catch a partial write in:
     * a plain `writeFileSync` truncates the target and then fills it, so the empty moment is the
     * window this whole requirement exists to survive. Treating it as absent would leave the
     * commonest case of the defect completely unguarded — which is exactly what the R2 probe caught
     * when the first version of this did.
     */
    settingsUnreadable = existsSync(store.pathOf({ kind: 'settings' }));
  } else {
    try {
      const parsed: unknown = JSON.parse(rawSettings);
      // A document that parses to something other than an object is unusable too — an array or a
      // bare string is not settings, and `parseSettingsGuarded` reports it for the same reason.
      settingsUnreadable = parseSettingsGuarded(parsed).unreadable === true;
    } catch {
      settingsUnreadable = true;
    }
  }

  /*
   * `parseSettingsGuarded`, not `guardedSettingsValidator` — the REPORTING validator (031, FR-013a).
   *
   * Both correct the document; only this one tells the store that it had to, which is what lets
   * UI-main write the corrected form back. And it matters HERE rather than only at startup: this
   * function is what the config watcher calls on every file change, so a value hand-edited out of
   * range while the app runs is corrected and written back on the reload, not left to disagree
   * with the running app until the next launch.
   */
  const settings = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseSettingsGuarded);
  // Confine the active-theme name to a safe single segment before it becomes a file
  // path — a hand-edited `appearance.theme` like "../../x" must not read off-tree.
  const activeThemeName = isValidThemeName(settings.appearance.theme)
    ? settings.appearance.theme
    : THRONG_THEME.name;
  const theme = await store.read(
    { kind: 'theme', name: activeThemeName },
    THRONG_THEME,
    (raw) => (raw && typeof raw === 'object' ? { ...THRONG_THEME, ...(raw as Partial<Theme>) } : THRONG_THEME),
    { create: false }, // a settings-named theme that doesn't exist falls back to defaults, no stray file (#6)
  );
  const keybindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
  const iconPacks = await loadIconPacks();
  return { payload: { settings, theme, keybindings, iconPacks }, settingsUnreadable };
}

/**
 * Read the configuration, looking again if the settings document could not be read (032, FR-008).
 *
 * ══ THE EDGE CASE THIS CLOSES ══
 *
 * A re-read used to happen only when the watcher fired, and the watcher fires only when a file
 * changes. So a single bad read — the watcher waking mid-write, a scanner holding the file for a
 * moment — broadcast the shipped defaults as though they were the user's settings, and then NOTHING
 * looked again. Every open window stayed on the defaults indefinitely, until something touched the
 * file. The change was lost rather than late, which is why no timeout ever helped.
 *
 * - **G6.** A broadcast is never derived from an unreadable read while a retry remains.
 * - **G7.** Once the retries are spent, the last read is broadcast ANYWAY. A genuinely corrupt file
 *   must surface to the user as the app running on defaults, not as an app that quietly stopped
 *   accepting configuration changes — silence is the worse failure, and it is indistinguishable
 *   from the bug this whole feature is about.
 */
export async function readConfigWithRetry(
  store: IConfigStore,
  policy: ConfigWatchPolicy = DEFAULT_CONFIG_WATCH_POLICY,
  loadIconPacks?: () => Promise<LoadedIconPack[]>,
): Promise<ConfigReadResult> {
  const attempts = Math.max(1, policy.attempts);
  let last = await readConfigOnce(store, loadIconPacks);
  for (let attempt = 1; attempt < attempts && last.settingsUnreadable; attempt += 1) {
    await delay(policy.intervalMs);
    last = await readConfigOnce(store, loadIconPacks);
  }
  if (last.settingsUnreadable) {
    // Said once per exhausted read, not once per attempt: the diagnostics log is where a user's
    // "my settings stopped applying" is reconstructed from, and a line per retry would bury it.
    console.error(
      `[config-watcher] settings.json could not be read after ${attempts} attempts; running on defaults`,
    );
  }
  return last;
}

/** Begin watching the config root; re-read + broadcast on every (debounced) change. */
export function startConfigWatcher(deps: {
  store: IConfigStore;
  watcher: IFileWatcher;
  config: IConfigSettings;
  broadcast: (payload: ConfigPayload) => void;
  loadIconPacks?: () => Promise<LoadedIconPack[]>;
  /** Injected at the main composition root; defaults here so existing callers are unaffected. */
  policy?: ConfigWatchPolicy;
}): Disposable {
  return deps.watcher.watch(deps.config.configRoot, () => {
    void readConfigWithRetry(deps.store, deps.policy ?? DEFAULT_CONFIG_WATCH_POLICY, deps.loadIconPacks).then(
      (result) => deps.broadcast(result.payload),
    );
  });
}
