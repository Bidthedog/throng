/**
 * Reading settings WITH the declared-bounds guard applied (031, #227).
 *
 * This module exists for one structural reason: `settings-metadata.ts` imports
 * `DEFAULT_APP_SETTINGS` from `app-settings.ts`, so `app-settings.ts` cannot import the registry
 * back without closing an import cycle. A cycle here would not fail loudly — it would leave
 * `SETTINGS_METADATA` undefined at module-init time and silently guard nothing, which is the exact
 * class of quiet failure #227 is about. So the guard is composed here, one level up, where both
 * halves are already loaded.
 *
 * Every reader of settings should call {@link parseSettingsGuarded}. `parseAppSettings` remains the
 * unguarded merge and is now an implementation detail of it.
 */
import { DEFAULT_APP_SETTINGS, parseAppSettings, type AppSettings } from './app-settings.js';
import { applyDeclaredBounds, type CorrectionOutcome } from './bounds-guard.js';
import { SETTINGS_METADATA } from './settings-metadata.js';

/**
 * Parse raw settings JSON, clamping every declared bound first.
 *
 * Returns whether anything MOVED as well as the value, because that is what lets a caller write the
 * file back when it needed correcting and leave a clean one untouched — the difference between a
 * guard and a churn machine.
 */
export function parseSettingsGuarded(raw: unknown): CorrectionOutcome<AppSettings> {
  const guarded = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
  return {
    value: parseAppSettings(guarded.value),
    corrected: guarded.corrected,
    corrections: guarded.corrections,
    /*
     * UNREADABLE, reported without changing the value (032, FR-008).
     *
     * A settings document is a JSON object. Anything else — an array, a string, a number, `null` —
     * is a file that exists and cannot be used, which is a different situation from a file with a
     * value out of range and calls for a different response: the caller may want to look again
     * before it believes the defaults it is being handed.
     *
     * `undefined` is NOT unreadable. It is what an absent document looks like once the file layer
     * has resolved it, and there is nothing wrong with a machine that has no settings yet.
     */
    unreadable: raw !== undefined && !isPlainObject(raw),
  };
}

/** A JSON object — the only shape a configuration document is ever allowed to be. */
function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `validate` callback shape the config store expects, with the guard applied. */
export function guardedSettingsValidator(raw: unknown): AppSettings {
  return parseSettingsGuarded(raw).value;
}
