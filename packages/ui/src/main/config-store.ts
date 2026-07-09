/**
 * FileConfigStore — the UI-main concrete {@link IConfigStore} (T033 / contract
 * os-config-store.md). Stores the user-scoped config documents as human-editable
 * JSON under a configured root (`%USERPROFILE%\.throng\` in production, a temp
 * dir in tests). I/O only: parsing/validation/default-merge is delegated to the
 * pure `@throng/core/config` schema functions supplied by the caller.
 *
 * Behaviour (research D1): an absent document is created from defaults and the
 * defaults returned; a malformed document resolves to defaults and is left
 * untouched on disk so the user can fix their edit; writes are atomic (temp file
 * + rename) and best-effort (a failure is logged, never thrown).
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ALL_DEFAULT_THEMES, checkRename, THRONG_THEME, type ConfigDocId, type ConfigReadOptions, type IConfigStore, type ThemeRenameResult } from '@throng/core';

export class FileConfigStore implements IConfigStore {
  /** Monotonic counter giving each write its own temp file, so concurrent writes
   *  to the same document never race on a shared `.tmp` (rapid theme edits). */
  private writeSeq = 0;

  constructor(private readonly configRoot: string) {}

  pathOf(doc: ConfigDocId): string {
    switch (doc.kind) {
      case 'settings':
        return join(this.configRoot, 'settings.json');
      case 'keybindings':
        return join(this.configRoot, 'keybindings.json');
      case 'theme':
        return join(this.configRoot, 'themes', `${doc.name}.json`);
    }
  }

  async read<T>(
    doc: ConfigDocId,
    defaults: T,
    validate: (raw: unknown) => T,
    options?: ConfigReadOptions,
  ): Promise<T> {
    const path = this.pathOf(doc);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      // Absent → create from defaults and return them (first-run), UNLESS the
      // caller opted out (e.g. a theme named by settings that doesn't exist —
      // we must not write a stray file; we fall back to the hardcoded defaults).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && options?.create !== false) {
        await this.write(doc, defaults);
      }
      return defaults;
    }
    try {
      return validate(JSON.parse(raw) as unknown);
    } catch {
      // Malformed JSON → defaults; leave the user's file intact (D1).
      return defaults;
    }
  }

  async write<T>(doc: ConfigDocId, value: T): Promise<void> {
    const path = this.pathOf(doc);
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${(this.writeSeq += 1)}.tmp`; // unique per write (no shared-tmp race)
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(tmp, path); // atomic replace (libuv MoveFileEx w/ replace on Windows)
    } catch (err) {
      // Best-effort: surface the failure without crashing the app (contract).
      console.error(`[config-store] failed to write ${path}:`, err);
    }
  }

  // ---- 007 theme-file management (Themes tab) ----

  /** Raw on-disk text of a config document ('' if absent) — for the JSON editor
   *  so a malformed file shows verbatim for repair (FR-043 JSON side). */
  async readRaw(doc: ConfigDocId): Promise<string> {
    try {
      return await readFile(this.pathOf(doc), 'utf8');
    } catch {
      return '';
    }
  }

  private themesDir(): string {
    return dirname(this.pathOf({ kind: 'theme', name: '_' }));
  }

  /** Theme names present in the themes/ directory (always includes `throng`). */
  async listThemes(): Promise<string[]> {
    const names = new Set<string>([THRONG_THEME.name]);
    try {
      for (const entry of await readdir(this.themesDir(), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
          names.add(entry.name.slice(0, -'.json'.length));
        }
      }
    } catch {
      // themes dir absent → just the built-in default
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** Rename a theme file, rejecting a collision (FR-036a). */
  async renameTheme(from: string, to: string): Promise<ThemeRenameResult> {
    const existing = await this.listThemes();
    const check = checkRename(existing, from, to);
    if (!check.ok) return check;
    if (from === to) return { ok: true };
    try {
      await rename(this.pathOf({ kind: 'theme', name: from }), this.pathOf({ kind: 'theme', name: to }));
      return { ok: true };
    } catch (err) {
      console.error(`[config-store] failed to rename theme ${from}→${to}:`, err);
      return { ok: false, error: 'invalid' };
    }
  }

  /** Delete a theme file (caller has confirmed — FR-036). */
  async deleteTheme(name: string): Promise<void> {
    try {
      await rm(this.pathOf({ kind: 'theme', name }), { force: true });
    } catch (err) {
      console.error(`[config-store] failed to delete theme ${name}:`, err);
    }
  }

  /**
   * Re-create any missing built-in default themes from their installed source
   * (FR-037). US4 seeds only `throng`; US7 extends `source` to the 14 defaults.
   * Existing user themes are untouched. Returns the resulting theme list.
   */
  async restoreDefaultThemes(source: Record<string, unknown> = ALL_DEFAULT_THEMES): Promise<string[]> {
    for (const [name, theme] of Object.entries(source)) {
      // Check the actual FILE (not listThemes, which always reports the built-in
      // `throng` present) so a deleted default file is genuinely re-created.
      try {
        await readFile(this.pathOf({ kind: 'theme', name }), 'utf8');
      } catch {
        await this.write({ kind: 'theme', name }, theme);
      }
    }
    return this.listThemes();
  }
}
