/**
 * ShippedDefaultsService (feature 010) — the UI-main I/O applier for the
 * shipped-defaults record. Reads current on-disk config via {@link FileConfigStore},
 * computes plans with the pure `@throng/core` shipped-defaults functions, and
 * applies them atomically (whole-operation, with rollback) through
 * {@link FileConfigStore.writeFilesAtomic}. It ships NO UI; `014-theme-editor` and
 * `015-preferences-and-settings` build controls on top of these operations.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  parseAppSettings,
  parseKeybindings,
  planThemeUpgrade,
  reservedThemeNames,
  resetBindingValue,
  resetSettingValue,
  type ShippedDefaults,
  type Theme,
} from '@throng/core';
import { FileConfigStore, type WriteAllResult } from './config-store.js';

export type RestoreResult = { ok: true } | { ok: false; failedPath: string; error: string };
export type UpgradeResult =
  | { ok: true; added: string[]; filled: string[] }
  | { ok: false; failedPath: string; error: string };
export interface ResetOne {
  ok: boolean;
  reason?: 'no-default';
}

/** The applied-defaults version marker document, stored in the config root. */
const MARKER_FILE = 'defaults-state.json';

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export class ShippedDefaultsService {
  constructor(
    private readonly store: FileConfigStore,
    private readonly shipped: ShippedDefaults,
  ) {}

  /** Absolute path of the applied-defaults version marker (`<root>/defaults-state.json`). */
  private markerPath(): string {
    const root = dirname(this.store.pathOf({ kind: 'settings' }));
    return join(root, MARKER_FILE);
  }

  private themeFile(name: string): { path: string; content: string } {
    return { path: this.store.pathOf({ kind: 'theme', name }), content: FileConfigStore.serialize(this.shipped.themes[name]) };
  }

  private markerFile(): { path: string; content: string } {
    return { path: this.markerPath(), content: FileConfigStore.serialize({ version: this.shipped.version }) };
  }

  /** FR-008: reset every built-in theme to its shipped values, recreating any the
   *  user deleted. Custom themes (names not in the record) are never touched. */
  async restoreAllThemes(): Promise<RestoreResult> {
    const files = reservedThemeNames(this.shipped).map((name) => this.themeFile(name));
    return this.store.writeFilesAtomic(files);
  }

  /** FR-015: full reset — settings + keybindings + every built-in theme from the record. */
  async resetEverything(): Promise<RestoreResult> {
    const files = [
      { path: this.store.pathOf({ kind: 'settings' }), content: FileConfigStore.serialize(this.shipped.settings) },
      { path: this.store.pathOf({ kind: 'keybindings' }), content: FileConfigStore.serialize(this.shipped.keybindings) },
      ...reservedThemeNames(this.shipped).map((name) => this.themeFile(name)),
    ];
    return this.store.writeFilesAtomic(files);
  }

  /** FR-009/016: reset one action's binding to its shipped value; others untouched. */
  async resetBinding(action: string): Promise<ResetOne> {
    const current = await this.store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    const next = resetBindingValue(current, action, this.shipped);
    if (next === null) return { ok: false, reason: 'no-default' };
    const res = await this.store.writeFilesAtomic([
      { path: this.store.pathOf({ kind: 'keybindings' }), content: FileConfigStore.serialize(next) },
    ]);
    return { ok: res.ok };
  }

  /** FR-010/011/016: reset one setting leaf (dotted path) to its shipped value. */
  async resetSetting(path: string): Promise<ResetOne> {
    const current = await this.store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    const next = resetSettingValue(current, path, this.shipped);
    if (next === null) return { ok: false, reason: 'no-default' };
    const res = await this.store.writeFilesAtomic([
      { path: this.store.pathOf({ kind: 'settings' }), content: FileConfigStore.serialize(next) },
    ]);
    return { ok: res.ok };
  }

  /**
   * FR-015: first-run seed — settings + keybindings + all built-in themes + the
   * version marker, sourced from the record. NON-DESTRUCTIVE (create-if-absent
   * per document): a document a user (or test) has already placed is preserved,
   * never clobbered. On a truly-empty config root every document is written, so
   * the result equals the shipped artifacts exactly.
   */
  async seed(): Promise<RestoreResult> {
    const candidates = [
      { path: this.store.pathOf({ kind: 'settings' }), content: FileConfigStore.serialize(this.shipped.settings) },
      { path: this.store.pathOf({ kind: 'keybindings' }), content: FileConfigStore.serialize(this.shipped.keybindings) },
      ...reservedThemeNames(this.shipped).map((name) => this.themeFile(name)),
      this.markerFile(),
    ];
    const absent: Array<{ path: string; content: string }> = [];
    for (const c of candidates) {
      if (!(await fileExists(c.path))) absent.push(c);
    }
    if (absent.length === 0) return { ok: true };
    return this.store.writeFilesAtomic(absent);
  }

  /**
   * FR-015a: additive-only upgrade. Adds newly-shipped themes absent from config
   * and materialises newly-added theme properties into existing theme files
   * (built-ins from their shipped value, customs from the base throng default),
   * NEVER changing a value the user already has. Records the current version.
   * Idempotent.
   */
  async upgrade(): Promise<UpgradeResult> {
    const present = await this.readPresentThemes();
    const plan = planThemeUpgrade({ shipped: this.shipped, present, throngBase: this.shipped.themes.throng });
    const files: Array<{ path: string; content: string }> = [];
    for (const { name, theme } of plan.addThemes) {
      files.push({ path: this.store.pathOf({ kind: 'theme', name }), content: FileConfigStore.serialize(theme) });
    }
    for (const { name, theme } of plan.fillThemes) {
      files.push({ path: this.store.pathOf({ kind: 'theme', name }), content: FileConfigStore.serialize(theme) });
    }
    files.push(this.markerFile());
    const res: WriteAllResult = await this.store.writeFilesAtomic(files);
    if (!res.ok) return res;
    return { ok: true, added: plan.addThemes.map((a) => a.name), filled: plan.fillThemes.map((f) => f.name) };
  }

  /** Read the applied-defaults version marker (`null` if absent or unreadable). */
  async readAppliedVersion(): Promise<number | null> {
    try {
      const text = await readFile(this.markerPath(), 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'number') {
        return (parsed as { version: number }).version;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Themes actually present on disk (parsed), including custom themes. */
  private async readPresentThemes(): Promise<Record<string, Theme>> {
    const present: Record<string, Theme> = {};
    for (const name of await this.store.listThemes()) {
      const raw = await this.store.readRaw({ kind: 'theme', name });
      if (!raw || raw.trim().length === 0) continue; // phantom (e.g. throng with no file)
      try {
        present[name] = JSON.parse(raw) as Theme;
      } catch {
        // Malformed on disk → omit from `present`. A malformed CUSTOM theme is thus
        // left untouched for the user to repair. A malformed BUILT-IN, being absent
        // from `present`, is recreated from the record by planThemeUpgrade.addThemes
        // — intentional, matching US2.5 (a corrupt built-in is restorable) and still
        // additive-only (no present value is changed).
      }
    }
    return present;
  }
}
