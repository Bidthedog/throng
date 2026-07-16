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
import { ALL_DEFAULT_THEMES, checkRename, type ConfigDocId, type ConfigReadOptions, type IConfigStore, type ThemeRenameResult, type WriteOutcome } from '@throng/core';

/** Result of a transactional multi-file write (010, FR-012/012a). */
export type WriteAllResult = { ok: true } | { ok: false; failedPath: string; error: string };

/**
 * Rename failures that are worth retrying (issue #75).
 *
 * On Windows a replace-rename fails with EPERM/EACCES/EBUSY while ANOTHER process holds a
 * handle on the target without share-delete — Defender, the search indexer, or our own config
 * watcher reading the file it was just told changed. The handle is released milliseconds later,
 * so the operation is not really failing, it is arriving early. Every other errno (a missing
 * source, a bad path) is a real fault and is reported at once rather than retried into a stall.
 */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Ceiling on the retry window. Comfortably longer than a scanner's handle (tens of ms), and
 *  far short of any caller's patience — a write that has not landed in a second has really failed. */
const RENAME_RETRY_BUDGET_MS = 1_000;
const RENAME_RETRY_INTERVAL_MS = 20;

/**
 * `rename`, retried while the target is transiently locked (issue #75).
 *
 * Mirrors the bounded rename-poll `windows-directory-lock` already uses for the same class of
 * Windows handle contention. Bounded so a genuinely stuck handle surfaces as a failure instead
 * of hanging the write.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const deadline = Date.now() + RENAME_RETRY_BUDGET_MS;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT_RENAME_CODES.has(code) || Date.now() >= deadline) throw err;
      await delay(RENAME_RETRY_INTERVAL_MS);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FileSnapshot {
  path: string;
  content: string;
  existed: boolean;
  original?: Buffer;
  tmp: string;
}

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

  async write<T>(doc: ConfigDocId, value: T): Promise<WriteOutcome> {
    const path = this.pathOf(doc);
    let tmp: string | undefined;
    try {
      await mkdir(dirname(path), { recursive: true });
      tmp = `${path}.${(this.writeSeq += 1)}.tmp`; // unique per write (no shared-tmp race)
      await writeFile(tmp, FileConfigStore.serialize(value), 'utf8');
      await renameWithRetry(tmp, path); // atomic replace (libuv MoveFileEx w/ replace on Windows)
      return { ok: true };
    } catch (err) {
      // Never throw (contract) — but never claim success either (issue #75): the caller decides
      // what a lost edit means. Drop the staged temp so a failed write leaves no litter behind.
      console.error(`[config-store] failed to write ${path}:`, err);
      if (tmp) await rm(tmp, { force: true }).catch(() => undefined);
      return { ok: false, error: errorMessage(err) };
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

  /**
   * Theme names ACTUALLY present in the themes/ directory.
   *
   * This used to always inject `throng` so feature 007's theme dropdown never had an empty
   * selection. That dropdown is gone (014 replaced it with a row list), and the phantom actively
   * lied: a deleted `throng` still reported as present, so it never surfaced as a
   * "deleted/restorable" row and could not be recreated (FR-005a). Callers that need the built-in
   * as a fallback resolve it from the shipped record instead. `readPresentThemes` already skipped
   * the phantom, so its behaviour is unchanged.
   */
  async listThemes(): Promise<string[]> {
    const names = new Set<string>();
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

  // ---- 010 shipped-defaults: transactional multi-file write (FR-012/012a) ----

  /** Serialise a value to the on-disk JSON form used by every config write. */
  static serialize(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  /**
   * Write many files as a single all-or-nothing operation (FR-012/012a). Stages
   * every file to a temp, then commits with atomic renames; on the FIRST failure
   * (realistically a locked/unwritable target on Windows) it discards the staging
   * and rolls back any already-committed files to their prior bytes (deleting
   * those that did not exist before), leaving the previous configuration exactly
   * as it was, and reports the offending path. Absolute `path`s only.
   */
  async writeFilesAtomic(files: Array<{ path: string; content: string }>): Promise<WriteAllResult> {
    const snaps: FileSnapshot[] = [];
    for (const f of files) {
      let existed = false;
      let original: Buffer | undefined;
      try {
        original = await readFile(f.path);
        existed = true;
      } catch {
        existed = false; // absent before
      }
      snaps.push({ path: f.path, content: f.content, existed, original, tmp: `${f.path}.${(this.writeSeq += 1)}.staging` });
    }

    // Stage phase: any failure here means nothing on disk was replaced.
    for (const s of snaps) {
      try {
        await mkdir(dirname(s.path), { recursive: true });
        await writeFile(s.tmp, s.content, 'utf8');
      } catch (err) {
        await this.cleanupTemps(snaps);
        return { ok: false, failedPath: s.path, error: errorMessage(err) };
      }
    }

    // Commit phase: atomic renames. On the first failure, roll back the committed
    // ones and clean up the rest.
    const committed: FileSnapshot[] = [];
    for (const s of snaps) {
      try {
        await rename(s.tmp, s.path);
        committed.push(s);
      } catch (err) {
        await this.rollback(committed);
        await this.cleanupTemps(snaps.filter((x) => !committed.includes(x)));
        return { ok: false, failedPath: s.path, error: errorMessage(err) };
      }
    }
    return { ok: true };
  }

  private async cleanupTemps(snaps: FileSnapshot[]): Promise<void> {
    for (const s of snaps) {
      await rm(s.tmp, { force: true }).catch(() => {
        /* best-effort */
      });
    }
  }

  private async rollback(committed: FileSnapshot[]): Promise<void> {
    for (const s of committed) {
      try {
        if (s.existed && s.original !== undefined) {
          const tmp = `${s.path}.${(this.writeSeq += 1)}.rollback`;
          await writeFile(tmp, s.original);
          await rename(tmp, s.path);
        } else {
          await rm(s.path, { force: true });
        }
      } catch (err) {
        console.error(`[config-store] rollback failed for ${s.path}:`, err);
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
