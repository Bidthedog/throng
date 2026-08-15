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
  guardedSettingsValidator,
  parseKeybindings,
  planSettingsUpgrade,
  planThemeUpgrade,
  reservedThemeNames,
  resetBindingValue,
  resetSettingValue,
  setAtPath,
  type ConfigDocId,
  type ShippedDefaults,
  type Theme,
} from '@throng/core';
import { FileConfigStore, type WriteAllResult } from './config-store.js';
import { withDocumentLock, withDocumentsLock } from './config-write-lock.js';

export type RestoreResult = { ok: true } | { ok: false; failedPath: string; error: string };
export type UpgradeResult =
  | { ok: true; added: string[]; filled: string[] }
  | { ok: false; failedPath: string; error: string };
export interface ResetOne {
  ok: boolean;
  /**
   * `no-default` — the path names nothing in the shipped record, so there is nothing to reset to.
   *
   * `unreadable` — the document exists but does not parse, so there is no base to apply the reset
   * to (032, FR-006a). Refusing is the whole point: these methods used to read through a
   * `DEFAULT_APP_SETTINGS` / `DEFAULT_KEYBINDINGS` fallback, so resetting ONE leaf against a corrupt
   * file wrote the entire shipped document and silently discarded every other choice the user had
   * made. A reset that cannot read what it is modifying has to stop, not guess.
   */
  reason?: 'no-default' | 'unreadable';
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

  private settingsFile(): { path: string; content: string } {
    return { path: this.store.pathOf({ kind: 'settings' }), content: FileConfigStore.serialize(this.shipped.settings) };
  }

  private keybindingsFile(): { path: string; content: string } {
    return { path: this.store.pathOf({ kind: 'keybindings' }), content: FileConfigStore.serialize(this.shipped.keybindings) };
  }

  private markerFile(): { path: string; content: string } {
    return { path: this.markerPath(), content: FileConfigStore.serialize({ version: this.shipped.version }) };
  }

  /** FR-008: reset every built-in theme to its shipped values, recreating any the
   *  user deleted. Custom themes (names not in the record) are never touched. */
  async restoreAllThemes(): Promise<RestoreResult> {
    const names = reservedThemeNames(this.shipped);
    // Wholesale by definition — it writes the shipped values and reads nothing — but it still takes
    // the locks, so it cannot land in the middle of another writer's read-modify-write cycle.
    return withDocumentsLock(
      names.map((name): ConfigDocId => ({ kind: 'theme', name })),
      async () => this.store.writeFilesAtomic(names.map((name) => this.themeFile(name))),
    );
  }

  /**
   * Feature 014, FR-005/FR-005a: restore ONE built-in theme to its shipped value, recreating it
   * if the user had deleted it, touching no other theme. A thin single-file operation on top of
   * feature 010's shipped record + atomic write — it does not re-implement either. A name that is
   * not a reserved built-in is refused (`error:'not-reserved'`) and nothing is written.
   */
  async restoreTheme(name: string): Promise<RestoreResult> {
    if (!reservedThemeNames(this.shipped).includes(name)) {
      return { ok: false, failedPath: '', error: 'not-reserved' };
    }
    return withDocumentLock({ kind: 'theme', name }, async () =>
      this.store.writeFilesAtomic([this.themeFile(name)]),
    );
  }

  /**
   * Feature 015, FR-011/FR-011b: restore the whole SETTINGS document from the shipped
   * record — what the preferences window's per-tab "Reset to Defaults" runs on the
   * Settings tab. A thin single-file operation on top of the record + the atomic write,
   * exactly like {@link restoreTheme}. It exists so the RENDERER never computes a
   * defaults document: doing that is what gave the app a second, drifting notion of
   * "shipped default" in the first place.
   */
  async resetSettings(): Promise<RestoreResult> {
    return withDocumentLock({ kind: 'settings' }, async () =>
      this.store.writeFilesAtomic([this.settingsFile()]),
    );
  }

  /** Feature 015, FR-011/FR-011b: the Key Bindings counterpart of {@link resetSettings}. */
  async resetKeybindings(): Promise<RestoreResult> {
    return withDocumentLock({ kind: 'keybindings' }, async () =>
      this.store.writeFilesAtomic([this.keybindingsFile()]),
    );
  }

  /** FR-015: full reset — settings + keybindings + every built-in theme from the record. */
  async resetEverything(): Promise<RestoreResult> {
    const names = reservedThemeNames(this.shipped);
    /*
     * The widest operation there is, and the one that most needs the lock: it spans three document
     * kinds, so taking a single-document lock would leave the others racing every other writer for
     * the duration — atomic on disk and still losing edits.
     */
    return withDocumentsLock(
      [
        { kind: 'settings' },
        { kind: 'keybindings' },
        ...names.map((name): ConfigDocId => ({ kind: 'theme', name })),
      ],
      async () =>
        this.store.writeFilesAtomic([
          this.settingsFile(),
          this.keybindingsFile(),
          ...names.map((name) => this.themeFile(name)),
        ]),
    );
  }

  /** FR-009/016: reset one action's binding to its shipped value; others untouched. */
  async resetBinding(action: string): Promise<ResetOne> {
    // The exact twin of resetSetting, and it had the exact same two defects: no serialisation, and a
    // DEFAULT_KEYBINDINGS fallback that replaced every OTHER chord the user had rebound when the
    // document could not be parsed (032, FR-001c).
    return withDocumentLock({ kind: 'keybindings' }, async () =>
      this.resetLeaf(
        { kind: 'keybindings' },
        DEFAULT_KEYBINDINGS,
        parseKeybindings,
        (current) => resetBindingValue(current, action, this.shipped),
      ),
    );
  }

  /** FR-010/011/016: reset one setting leaf (dotted path) to its shipped value. */
  async resetSetting(path: string): Promise<ResetOne> {
    // 032 FR-002a — the read and the write are ONE critical section. Atomicity of the file replace
    // says nothing about the gap between them, and that gap is where a concurrent write is lost.
    return withDocumentLock({ kind: 'settings' }, async () =>
      this.resetLeaf(
        { kind: 'settings' },
        DEFAULT_APP_SETTINGS,
        guardedSettingsValidator,
        (current) => resetSettingValue(current, path, this.shipped),
      ),
    );
  }

  /**
   * Reset ONE leaf of a document to its shipped value (032, FR-001b/FR-001c/FR-006a).
   *
   * ══ WHAT THIS FIXES, AND WHAT IT DELIBERATELY DOES NOT ══
   *
   * It fixes the data-loss path: these methods used to read through a `DEFAULT_APP_SETTINGS` /
   * `DEFAULT_KEYBINDINGS` fallback, so resetting ONE leaf against a document that could not be
   * parsed wrote the entire shipped document and silently discarded every other choice the user had
   * made. Now an unparseable base is REFUSED and nothing is written.
   *
   * It does NOT try to preserve keys the schema does not model, and an earlier revision that did
   * was wrong. The pure `resetSettingValue`/`resetBindingValue` helpers take a TYPED document, so
   * the raw file goes through the parse — which drops unmodelled keys. That looked like data loss
   * and is in fact the shipped, tested behaviour of every write in this application: 007 FR-023 and
   * `preferences-settings.e2e.ts` (#95, C1) require a hand-written unknown key to be stripped by the
   * next ordinary write, and state the mechanism as "the key simply does not survive a parse".
   *
   * Reverting that over-correction is the point of this note. The test that appeared to find a
   * defect — a hand-written key not surviving a reset — was asserting a requirement nobody had, and
   * it contradicted one that shipped two releases ago.
   */
  private async resetLeaf<T>(
    doc: ConfigDocId,
    fallback: T,
    guard: (raw: unknown) => T,
    computeNext: (current: T) => T | null,
  ): Promise<ResetOne> {
    const raw = await this.store.readRaw(doc);

    let current: T;
    if (raw.trim().length === 0) {
      // Absent → first run. Falling back to the shipped record is correct: there is nothing to
      // preserve, and this is the one case where a defaults fallback is not the bug.
      current = fallback;
    } else {
      try {
        current = guard(JSON.parse(raw));
      } catch {
        // Present but unparseable — the case FR-006a exists for. Refuse; write nothing.
        return { ok: false, reason: 'unreadable' };
      }
    }

    const next = computeNext(current);
    if (next === null) return { ok: false, reason: 'no-default' };

    const res = await this.store.writeFilesAtomic([
      { path: this.store.pathOf(doc), content: FileConfigStore.serialize(next) },
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
      this.settingsFile(),
      this.keybindingsFile(),
      ...reservedThemeNames(this.shipped).map((name) => this.themeFile(name)),
      this.markerFile(),
    ];
    /*
     * Under the lock, and the reasoning is worth recording because it looked like an exemption.
     *
     * `seed` runs at startup before a window exists, so it is *probably* unraceable — and "probably
     * harmless" is precisely the reasoning that hid four writers across three rounds of this spec.
     * It also has a genuine read-modify-write shape of its own: it tests existence and then writes
     * on the strength of that test, so a document arriving in the gap would be clobbered. Taking the
     * lock costs a startup path nothing, because nothing is contending for it.
     */
    return withDocumentsLock(this.seedDocIds(), async () => {
      const absent: Array<{ path: string; content: string }> = [];
      for (const c of candidates) {
        if (!(await fileExists(c.path))) absent.push(c);
      }
      if (absent.length === 0) return { ok: true };
      return this.store.writeFilesAtomic(absent);
    });
  }

  /** Every document `seed`/`upgrade` may touch. The marker file is not a config document. */
  private seedDocIds(): ConfigDocId[] {
    return [
      { kind: 'settings' },
      { kind: 'keybindings' },
      ...reservedThemeNames(this.shipped).map((name): ConfigDocId => ({ kind: 'theme', name })),
    ];
  }

  /**
   * The SETTINGS half of {@link upgrade} — one leaf, guarded (033 FR-070a/FR-070b).
   *
   * Returns the file to write, or `null` when nothing is owed. Reads and rewrites the RAW document
   * rather than a parsed `AppSettings`, so a key the schema does not model survives an upgrade the
   * user never asked for; the guard in `planSettingsUpgrade` is what keeps a customised value safe.
   *
   * An unparseable settings file is left ALONE. `resetLeaf` established the rule and its reasoning
   * holds twice over here: this runs unattended at startup, so guessing at a document it cannot read
   * would replace choices the user could still repair by hand.
   */
  private async settingsUpgradeFile(): Promise<{ path: string; content: string } | null> {
    const doc: ConfigDocId = { kind: 'settings' };
    const raw = await this.store.readRaw(doc);
    if (raw.trim().length === 0) return null; // absent → `seed` writes the shipped document
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const leaves = planSettingsUpgrade(parsed, this.shipped);
    if (leaves.length === 0) return null;
    let next = parsed;
    for (const leaf of leaves) next = setAtPath(next as Record<string, unknown>, leaf.path, leaf.value);
    return { path: this.store.pathOf(doc), content: FileConfigStore.serialize(next) };
  }

  /**
   * FR-015a: additive-only upgrade. Adds newly-shipped themes absent from config
   * and materialises newly-added theme properties into existing theme files
   * (built-ins from their shipped value, customs from the base throng default),
   * NEVER changing a value the user already has. Records the current version.
   * Idempotent.
   *
   * 033 FR-070a widened it past themes for the first time: one settings leaf,
   * `explorer.excludeGlobs`, rewritten only when it still deep-equals the value version 4 shipped.
   * The settings document joins the lock set for the same reason every other document is in it —
   * this is a read-modify-write, and the gap between the read and the write is where a concurrent
   * edit is lost.
   */
  async upgrade(): Promise<UpgradeResult> {
    /*
     * The clearest read-modify-write in the file: it reads every theme on disk, computes a plan from
     * what it found, and writes the result. Under the lock for the same reason as `seed` — and here
     * the shape is not even arguably exempt.
     *
     * The lock set spans the CUSTOM themes as well as the built-ins, because `fillThemes` writes
     * customs too (materialising newly-added properties from the throng base). Listing happens
     * before the lock, which is not a gap worth closing: `upgrade` runs at startup, and a theme file
     * appearing between the list and the lock would have to be created by a window that does not
     * exist yet.
     */
    const names = new Set([...reservedThemeNames(this.shipped), ...(await this.store.listThemes())]);
    return withDocumentsLock(
      [
        ...[...names].map((name): ConfigDocId => ({ kind: 'theme', name })),
        { kind: 'settings' },
      ],
      async () => {
        const present = await this.readPresentThemes();
        const plan = planThemeUpgrade({ shipped: this.shipped, present, throngBase: this.shipped.themes.throng });
        const files: Array<{ path: string; content: string }> = [];
        for (const { name, theme } of plan.addThemes) {
          files.push({ path: this.store.pathOf({ kind: 'theme', name }), content: FileConfigStore.serialize(theme) });
        }
        for (const { name, theme } of plan.fillThemes) {
          files.push({ path: this.store.pathOf({ kind: 'theme', name }), content: FileConfigStore.serialize(theme) });
        }
        // 033 FR-070a — the one settings leaf, or nothing at all.
        const settingsFile = await this.settingsUpgradeFile();
        if (settingsFile) files.push(settingsFile);
        files.push(this.markerFile());
        const res: WriteAllResult = await this.store.writeFilesAtomic(files);
        if (!res.ok) return res;
        return { ok: true, added: plan.addThemes.map((a) => a.name), filled: plan.fillThemes.map((f) => f.name) };
      },
    );
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
