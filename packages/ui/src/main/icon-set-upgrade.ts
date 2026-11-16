/**
 * The folder step of the 069 upgrade (research R6, FR-019, FR-020, FR-036).
 *
 * Before 069 the icon sets directory held packs (`<name>/pack.json`), two seeded by throng (`throng`
 * and `throng-svg`) and a `README.md`. Nothing is converted. Each pack becomes a backup the user can
 * migrate by hand, the two seeded packs are deleted when no one touched them, and the README goes.
 *
 * ══ THE MARKER ══
 *
 * `<configRoot>/icon-sets-upgrade.json` holds `{ pending, done }`. The FIRST attempt records the names
 * it will act on and from then on only those are ever acted on, so a set the user creates after the
 * upgrade is never renamed, even when an earlier attempt failed half-way and is being retried
 * (FR-020). `done` stops every later run.
 *
 * With no readable marker the step starts only when the configuration predates icon sets (its applied
 * shipped-defaults version is below 34). Otherwise a configuration copied without its marker, or a
 * marker left empty by a crash, would have the user's own sets renamed; it is marked done instead. The
 * marker is staged beside itself and renamed into place, so it is never seen half-written.
 *
 * Every failure (a file held open on Windows, say) is logged and the item stays pending for the next
 * start. Nothing is deleted on a failed check: an unreadable seeded folder is treated as customised.
 *
 * The history check and the backup name are core's (`classifySeededFolder`, `backupName`); they are
 * injected so this step is exercised on a real directory without the frozen history.
 */
import { createHash } from 'node:crypto';
import type * as nodeFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIconSetBackupName, logCaught, logExpected } from '@throng/core';

export type IconSetUpgradeFs = Pick<
  typeof nodeFs,
  'readdir' | 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'rm'
>;

export interface SeededFile {
  name: string;
  sha256: string;
}

export interface IconSetUpgradeDeps {
  /** `<configRoot>/icon-packs`. */
  dir: string;
  /** `<configRoot>/icon-sets-upgrade.json`. */
  stateFile: string;
  /** The configuration's applied shipped-defaults version, read before this start's upgrade, is below 34. */
  predatesIconSets: boolean;
  fs: IconSetUpgradeFs;
  /** True when a `throng` or `throng-svg` folder holds exactly what some release seeded (FR-036). */
  isUncustomised(name: string, files: readonly SeededFile[]): boolean;
  /** `<name>.bak`, or `<name>.bak.<n>` for the first free `n` (FR-019). */
  backupName(name: string, taken: readonly string[]): string;
}

export interface IconSetUpgradeState {
  pending: string[];
  done: boolean;
}

export interface IconSetUpgradeOutcome {
  /** Backups made, as `<from> -> <to>`. */
  renamed: string[];
  deleted: string[];
  failed: string[];
}

const README = 'README.md';
const SEEDED = new Set(['throng', 'throng-svg']);

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

export class IconSetUpgrade {
  constructor(private readonly deps: IconSetUpgradeDeps) {}

  async run(): Promise<IconSetUpgradeOutcome> {
    const outcome: IconSetUpgradeOutcome = { renamed: [], deleted: [], failed: [] };
    let state = await this.readState();
    if (state?.done) return outcome;
    if (!state) {
      if (!this.deps.predatesIconSets) {
        await this.writeState({ pending: [], done: true });
        return outcome;
      }
      state = { pending: await this.capture(), done: false };
      await this.writeState(state);
    }
    const remaining: string[] = [];
    for (const item of state.pending) {
      try {
        await this.act(item, outcome);
      } catch (error) {
        logCaught(`icon-set-upgrade: ${item}`, error);
        outcome.failed.push(item);
        remaining.push(item);
      }
    }
    await this.writeState({ pending: remaining, done: remaining.length === 0 });
    return outcome;
  }

  /** The folder names and `README.md` present now: the only things this upgrade will ever touch. */
  private async capture(): Promise<string[]> {
    try {
      const entries = await this.deps.fs.readdir(this.deps.dir, { withFileTypes: true });
      return entries
        .filter((e) => (e.isDirectory() && !isIconSetBackupName(e.name)) || (e.isFile() && e.name === README))
        .map((e) => e.name)
        .sort();
    } catch (error) {
      logExpected('icon-set-upgrade: capture', 'there is no icon sets folder to upgrade on a fresh install', error);
      return [];
    }
  }

  private async act(item: string, outcome: IconSetUpgradeOutcome): Promise<void> {
    const path = join(this.deps.dir, item);
    if (item === README) {
      if (await this.rm(path)) outcome.deleted.push(item);
      return;
    }
    if (SEEDED.has(item) && (await this.uncustomised(item, path)) === true) {
      if (await this.rm(path)) outcome.deleted.push(item);
      return;
    }
    let taken: string[];
    try {
      taken = await this.deps.fs.readdir(this.deps.dir);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return; // the whole folder has gone: nothing left to back up
      throw error;
    }
    if (!taken.includes(item)) return; // gone since the last attempt
    const to = this.deps.backupName(item, taken);
    await this.deps.fs.rename(path, join(this.deps.dir, to));
    outcome.renamed.push(`${item} -> ${to}`);
  }

  /** Delete recursively. False when it was already gone. */
  private async rm(path: string): Promise<boolean> {
    try {
      await this.deps.fs.rm(path, { recursive: true });
      return true;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return false;
      throw error;
    }
  }

  /** Whether a seeded folder is exactly what a release seeded. Any doubt means customised. */
  private async uncustomised(name: string, path: string): Promise<boolean> {
    try {
      const entries = await this.deps.fs.readdir(path, { withFileTypes: true });
      if (entries.some((e) => !e.isFile())) return false;
      const files: SeededFile[] = [];
      for (const entry of entries) {
        const bytes = await this.deps.fs.readFile(join(path, entry.name));
        files.push({ name: entry.name, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      return this.deps.isUncustomised(name, files);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return false;
      logExpected('icon-set-upgrade: check seeded folder', 'a folder that cannot be checked is treated as customised and backed up, never deleted', error);
      return false;
    }
  }

  private async readState(): Promise<IconSetUpgradeState | undefined> {
    try {
      const parsed = JSON.parse(await this.deps.fs.readFile(this.deps.stateFile, 'utf8')) as Partial<IconSetUpgradeState>;
      if (Array.isArray(parsed.pending) && typeof parsed.done === 'boolean') {
        return { pending: parsed.pending.filter((p): p is string => typeof p === 'string'), done: parsed.done };
      }
    } catch (error) {
      logExpected('icon-set-upgrade: read marker', 'the marker is absent before the first attempt', error);
    }
    return undefined;
  }

  private async writeState(state: IconSetUpgradeState): Promise<void> {
    await this.deps.fs.mkdir(dirname(this.deps.stateFile), { recursive: true });
    const staged = `${this.deps.stateFile}.tmp`;
    await this.deps.fs.writeFile(staged, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await this.deps.fs.rename(staged, this.deps.stateFile);
  }
}
