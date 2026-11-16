/**
 * User icon sets (spec 069), replacing the 007/017 icon-pack service.
 *
 * A user set is a folder under the icon sets directory. A `<key>.svg` for a known icon key is an
 * override of that key, read and sanitised ONCE and then served from memory (017 FR-006a, 069
 * FR-029): nothing here watches the folders, so editing a file changes nothing until the next
 * icon-set action in Preferences, each of which reads every set again (FR-041), or the next start.
 * The default set is compiled into core and is never a folder (FR-021).
 *
 * Nothing is seeded any more. The service writes one file of its own, `README.txt` (FR-023).
 *
 * Every path is built here, from a name this service has listed. A caller never supplies one
 * (contracts/icon-sets-ipc.md).
 *
 * A set that cannot be read is still LISTED, carrying an `error`: a set that silently vanished would
 * look exactly like a setting that does nothing (FR-016).
 */
import type * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_ICON_SET,
  DEFAULT_ICON_SET_NAME,
  ICON_KEYS,
  isIconKey,
  isIconSetBackupName,
  logCaught,
  logExpected,
  sanitiseSvg,
  type IconKey,
  type UserIconSetDto,
} from '@throng/core';

/** The slice of `node:fs/promises` this service uses, injected (Principle IX). */
export type IconSetFs = Pick<
  typeof nodeFs,
  'readdir' | 'readFile' | 'writeFile' | 'mkdir' | 'copyFile' | 'rm' | 'rename'
>;

export interface IconSetServiceDeps {
  /** `<configRoot>/icon-packs`: the folder name is historical (the theme key stays `iconPack`). */
  dir: string;
  fs: IconSetFs;
  /** The line ending of the README on this OS: CRLF on Windows, LF elsewhere. */
  eol: '\n' | '\r\n';
  /** The README text, with LF line endings. */
  readme: string;
  /** Move a file or folder to the OS Recycle Bin / Trash: a deleted set or a reset icon can be got back. */
  trash(path: string): Promise<void>;
}

export type IconSetFailure = 'invalid-name' | 'exists' | 'source-unavailable' | 'unknown-set' | 'unknown-key' | 'io';
export type IconSetResult = { ok: true } | { ok: false; reason: IconSetFailure; message: string };

const README_FILE = 'README.txt';

function fail(reason: IconSetFailure, message: string): IconSetResult {
  return { ok: false, reason, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/** A folder name this service will build a path from: one segment, nothing that climbs. */
function isSingleSegment(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

export class IconSetService {
  private sets: UserIconSetDto[] = [];

  constructor(private readonly deps: IconSetServiceDeps) {}

  /** The icon sets directory, for opening it in the file manager. */
  get dir(): string {
    return this.deps.dir;
  }

  /** Write the README and load every set. Awaited before the first config payload is read. */
  async init(): Promise<void> {
    await this.writeReadme();
    this.sets = await this.loadAll();
  }

  /** The loaded sets, served from memory. */
  list(): UserIconSetDto[] {
    return this.sets;
  }

  /** The folder of a LISTED set, or undefined. The one place a set name becomes a path. */
  pathOf(name: string): string | undefined {
    return this.sets.some((s) => s.name === name) ? join(this.deps.dir, name) : undefined;
  }

  /** Make sure the sets directory exists, so opening it in the file manager cannot fail on absence. */
  async ensureDir(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.dir, { recursive: true });
  }

  /** How many `.bak` folders sit in the sets directory (FR-038). */
  async countBackups(): Promise<number> {
    try {
      const entries = await this.deps.fs.readdir(this.deps.dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && isIconSetBackupName(e.name)).length;
    } catch (error) {
      logExpected('icon-set-service: count backups', 'the sets directory is absent until something creates it', error);
      return 0;
    }
  }

  /**
   * Read every set from disk again (069 FR-041): the folders, and every file in them. Every icon-set
   * action runs this, so a folder added, renamed or removed outside throng, or a file edited there, is
   * what the next action and the grid see.
   */
  async rescan(): Promise<void> {
    this.sets = await this.loadAll();
  }

  async reload(): Promise<IconSetResult> {
    await this.rescan();
    return { ok: true };
  }

  /** Rename a set's folder (FR-042). A change of case alone is allowed; the name is validated by the caller. */
  async rename(from: string, to: string): Promise<IconSetResult> {
    if (!this.sets.some((s) => s.name === from)) return fail('unknown-set', `No icon set named ${from}.`);
    if (!isSingleSegment(to) || to.toLowerCase() === DEFAULT_ICON_SET_NAME) {
      logExpected('icon-set-service: rename', 'the renderer validates names; a path-shaped name reaching main is refused', to);
      return fail('invalid-name', 'That is not a usable icon set name.');
    }
    if (to === from) return { ok: true };
    // Any OTHER entry answering to the name, in any case, is a clash. A change of case alone is still a rename of the
    // set itself, but a case-sensitive volume (Linux, a case-sensitive APFS volume: 070 FR-020) can hold `Mine`
    // beside `mine`, and renaming onto it would replace an empty one without a word.
    if (await this.entryExists(to, from)) {
      logExpected('icon-set-service: rename', 'a file or folder with that name appeared since the window listed the sets', to);
      return fail('exists', `An icon set named ${to} already exists.`);
    }
    try {
      await this.deps.fs.rename(join(this.deps.dir, from), join(this.deps.dir, to));
    } catch (error) {
      logCaught('icon-set-service: rename', error);
      return fail('io', messageOf(error));
    }
    await this.rescan();
    return { ok: true };
  }

  /** Delete a set: its folder goes to the OS trash (FR-043). */
  async remove(name: string): Promise<IconSetResult> {
    if (!this.sets.some((s) => s.name === name)) return fail('unknown-set', `No icon set named ${name}.`);
    try {
      await this.deps.trash(join(this.deps.dir, name));
    } catch (error) {
      logCaught('icon-set-service: delete set', error);
      return fail('io', messageOf(error));
    }
    await this.rescan();
    return { ok: true };
  }

  /** Reset one icon to the default set's: its `<key>.svg` goes to the OS trash (FR-044). */
  async resetIcon(set: string, key: string): Promise<IconSetResult> {
    if (!this.sets.some((s) => s.name === set)) return fail('unknown-set', `No icon set named ${set}.`);
    if (!isIconKey(key)) {
      logExpected('icon-set-service: reset icon', 'the renderer sends only listed keys; an unknown one is refused', key);
      return fail('unknown-key', `${key} is not an icon key.`);
    }
    try {
      await this.deps.trash(join(this.deps.dir, set, `${key}.svg`));
    } catch (error) {
      logCaught('icon-set-service: reset icon', error);
      return fail('io', messageOf(error));
    }
    await this.rescan();
    return { ok: true };
  }

  /** Whether anything by this name, in any case, sits in the sets directory now, apart from the entry `except`. */
  private async entryExists(name: string, except?: string): Promise<boolean> {
    try {
      const folded = name.toLowerCase();
      return (await this.deps.fs.readdir(this.deps.dir)).some((e) => e !== except && e.toLowerCase() === folded);
    } catch (error) {
      logExpected('icon-set-service: probe name', 'the sets directory may be absent; nothing is in it', error);
      return false;
    }
  }

  async create(name: string, from: string): Promise<IconSetResult> {
    if (!isSingleSegment(name) || name.toLowerCase() === DEFAULT_ICON_SET_NAME) {
      logExpected('icon-set-service: create', 'the renderer validates names; a path-shaped name reaching main is refused', name);
      return fail('invalid-name', 'That is not a usable icon set name.');
    }
    let source: UserIconSetDto | undefined;
    if (from !== DEFAULT_ICON_SET_NAME) {
      source = this.sets.find((s) => s.name === from);
      if (!source || source.error) {
        logExpected('icon-set-service: create', 'the source set was removed or failed to load since the window listed it', from);
        return fail('source-unavailable', `The icon set ${from} is not available to copy.`);
      }
    }
    const target = join(this.deps.dir, name);
    try {
      await this.deps.fs.mkdir(this.deps.dir, { recursive: true });
      await this.deps.fs.mkdir(target);
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        logExpected('icon-set-service: create', 'the user picked a name that is already taken', error);
        return fail('exists', `An icon set named ${name} already exists.`);
      }
      logCaught('icon-set-service: create folder', error);
      return fail('io', messageOf(error));
    }
    if (source) {
      /*
       * Every `<key>.svg` in the source folder NOW, as the grid's Overridden marks are by file presence
       * (FR-024, FR-027): one that failed to load is copied too. A folder named like an icon is not a file and
       * is never copied. A file gone since the source was loaded, or one that cannot be read, is skipped rather
       * than failing the whole copy; macOS answers ENOTSUP where the others answer EISDIR, for a link to a
       * folder (070). Any other failure undoes the copy.
       */
      try {
        const from = join(this.deps.dir, source.name);
        const files = (await this.deps.fs.readdir(from, { withFileTypes: true }))
          .filter((e) => !e.isDirectory() && e.name.endsWith('.svg') && isIconKey(e.name.slice(0, -4)))
          .map((e) => e.name);
        for (const file of files) {
          try {
            await this.deps.fs.copyFile(join(from, file), join(target, file));
          } catch (error) {
            if (!['ENOENT', 'EISDIR', 'ENOTSUP', 'EACCES', 'EPERM'].some((code) => isErrno(error, code))) throw error;
            logExpected('icon-set-service: copy set', `${file} cannot be read, so the copy goes without it`, error);
          }
        }
      } catch (error) {
        logCaught('icon-set-service: copy set', error);
        await this.removePartial(target);
        return fail('io', messageOf(error));
      }
    }
    this.replace(name, await this.loadSet(name));
    return { ok: true };
  }

  async override(set: string, key: string, replace: boolean): Promise<IconSetResult> {
    if (!this.sets.some((s) => s.name === set)) return fail('unknown-set', `No icon set named ${set}.`);
    if (!isIconKey(key)) {
      logExpected('icon-set-service: override', 'the renderer sends only listed keys; an unknown one is refused', key);
      return fail('unknown-key', `${key} is not an icon key.`);
    }
    const file = join(this.deps.dir, set, `${key}.svg`);
    try {
      await this.deps.fs.writeFile(file, DEFAULT_ICON_SET[key].replace(/\r\n?/g, '\n'), {
        encoding: 'utf8',
        flag: replace ? 'w' : 'wx',
      });
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        logExpected('icon-set-service: override', 'the file exists and the user has not yet agreed to replace it', error);
        return fail('exists', `${key}.svg already exists in ${set}.`);
      }
      logCaught('icon-set-service: override', error);
      return fail('io', messageOf(error));
    }
    this.replace(set, await this.loadSet(set));
    return { ok: true };
  }

  /** Remove a folder `create` made and could not fill, so a retry is not refused as `exists`. */
  private async removePartial(target: string): Promise<void> {
    try {
      await this.deps.fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      logCaught('icon-set-service: remove partly made set', error);
    }
  }

  /** README.txt: written when absent or different, left untouched when identical (FR-023). */
  private async writeReadme(): Promise<void> {
    const text = this.deps.readme.replace(/\r\n?/g, '\n').replace(/\n/g, this.deps.eol);
    const file = join(this.deps.dir, README_FILE);
    try {
      const existing = await this.deps.fs.readFile(file);
      if (existing.equals(Buffer.from(text, 'utf8'))) return;
    } catch (error) {
      logExpected('icon-set-service: probe README', 'the README is absent until first written', error);
    }
    try {
      await this.deps.fs.mkdir(this.deps.dir, { recursive: true });
      await this.deps.fs.writeFile(file, text, 'utf8');
    } catch (error) {
      logCaught('icon-set-service: write README', error);
    }
  }

  private async loadAll(): Promise<UserIconSetDto[]> {
    let names: string[];
    try {
      const entries = await this.deps.fs.readdir(this.deps.dir, { withFileTypes: true });
      names = entries
        // The default set's name is never a user set, in any case (FR-021, FR-025): a hand-made `throng`
        // folder, or one the upgrade could not move yet, is not offered.
        .filter((e) => e.isDirectory() && !isIconSetBackupName(e.name) && e.name.toLowerCase() !== DEFAULT_ICON_SET_NAME)
        .map((e) => e.name)
        .sort();
    } catch (error) {
      logExpected('icon-set-service: list sets', 'the sets directory is absent until something creates it; there are no sets', error);
      return [];
    }
    const sets: UserIconSetDto[] = [];
    for (const name of names) sets.push(await this.loadSet(name));
    return sets;
  }

  private replace(name: string, set: UserIconSetDto): void {
    const next = this.sets.filter((s) => s.name !== name);
    next.push(set);
    next.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.sets = next;
  }

  /** Read one set's folder. Never throws: a failure becomes the set's `error`. */
  private async loadSet(name: string): Promise<UserIconSetDto> {
    const folder = join(this.deps.dir, name);
    const set: UserIconSetDto = { name, overrides: {}, failures: {}, unrecognised: [] };
    let files: string[];
    try {
      files = (await this.deps.fs.readdir(folder)).sort();
    } catch (error) {
      logExpected('icon-set-service: read set', 'a set folder may be gone or unreadable; it is listed as unavailable with this reason', error);
      return { ...set, error: `Could not read the folder: ${messageOf(error)}` };
    }
    const known: ReadonlySet<string> = new Set(ICON_KEYS);
    for (const file of files) {
      const key = file.endsWith('.svg') ? file.slice(0, -4) : undefined;
      if (key === undefined || !known.has(key)) {
        set.unrecognised.push(file);
        continue;
      }
      await this.loadKey(folder, file, key as IconKey, set);
    }
    return set;
  }

  private async loadKey(folder: string, file: string, key: IconKey, set: UserIconSetDto): Promise<void> {
    try {
      const markup = sanitiseSvg(await this.deps.fs.readFile(join(folder, file), 'utf8'));
      if (markup === null) set.failures[key] = 'The file is not an SVG.';
      else set.overrides[key] = markup;
    } catch (error) {
      logExpected('icon-set-service: read icon file', 'a user file may be unreadable; that key draws the default icon', error);
      set.failures[key] = `Could not read the file: ${messageOf(error)}`;
    }
  }
}
