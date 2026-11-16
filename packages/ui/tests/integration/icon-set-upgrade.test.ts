import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IconSetUpgrade, type IconSetUpgradeDeps } from '../../src/main/icon-set-upgrade.js';

/**
 * Spec 069 T027 — the folder step of the upgrade, on a real temp config root (FR-019, FR-020, FR-036).
 *
 * Layer: integration — what it proves is renames, deletions and a marker file surviving a failure
 * half-way through, which only a real directory shows.
 *
 * The seeded-history decision (`isUncustomised`) is core's and is unit-tested there; here it is a
 * stand-in that calls a folder uncustomised when it holds exactly one file, `pack.json`, saying `seed`.
 */

let root: string;
let dir: string;
let marker: string;

const SEED = 'seed';

function put(folder: string, file: string, content: string): void {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, file), content, 'utf8');
}

function make(overrides: Partial<IconSetUpgradeDeps> = {}): IconSetUpgrade {
  return new IconSetUpgrade({
    dir,
    stateFile: marker,
    predatesIconSets: true,
    fs: fsp,
    isUncustomised: (_name, files) => files.length === 1 && files[0].name === 'pack.json' && files[0].sha256.length === 64,
    backupName: (name, taken) => {
      if (!taken.includes(`${name}.bak`)) return `${name}.bak`;
      let n = 2;
      while (taken.includes(`${name}.bak.${n}`)) n += 1;
      return `${name}.bak.${n}`;
    },
    ...overrides,
  });
}

const names = (): string[] => readdirSync(dir).sort();
const state = (): { pending: string[]; done: boolean } => JSON.parse(readFileSync(marker, 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-icon-upgrade-'));
  dir = join(root, 'icon-packs');
  marker = join(root, 'icon-sets-upgrade.json');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the folder step', () => {
  it('renames a user pack to <name>.bak with byte-identical contents', async () => {
    put('mypack', 'pack.json', '{"name":"mypack"}');
    put('mypack', 'a.svg', '<svg/>');
    await make().run();
    expect(names()).toEqual(['mypack.bak']);
    expect(readFileSync(join(dir, 'mypack.bak', 'a.svg'), 'utf8')).toBe('<svg/>');
    expect(readFileSync(join(dir, 'mypack.bak', 'pack.json'), 'utf8')).toBe('{"name":"mypack"}');
  });

  it('renames an edited throng-svg to throng-svg.bak, or .bak.2 when .bak is taken', async () => {
    put('throng-svg', 'pack.json', '{}');
    put('throng-svg', 'extra.svg', 'edited');
    put('throng-svg.bak', 'x', 'older backup');
    // throng-svg.bak exists before the first attempt, so it is not in `pending` and must survive as is.
    await make().run();
    expect(names()).toEqual(['throng-svg.bak', 'throng-svg.bak.2']);
    expect(readFileSync(join(dir, 'throng-svg.bak', 'x'), 'utf8')).toBe('older backup');
    expect(readFileSync(join(dir, 'throng-svg.bak.2', 'extra.svg'), 'utf8')).toBe('edited');
  });

  it('deletes an unedited throng, and README.md', async () => {
    put('throng', 'pack.json', SEED);
    writeFileSync(join(dir, 'README.md'), '# old readme', 'utf8');
    await make().run();
    expect(names()).toEqual([]);
  });

  it('leaves README.txt and anything that is not a folder or README.md alone', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'README.txt'), 'new readme', 'utf8');
    writeFileSync(join(dir, 'stray.txt'), 'x', 'utf8');
    await make().run();
    expect(names()).toEqual(['README.txt', 'stray.txt']);
  });

  it('does nothing when there is no icon sets folder, and is then done', async () => {
    await make().run();
    expect(existsSync(dir)).toBe(false);
    expect(state()).toEqual({ pending: [], done: true });
  });

  it('records done once everything succeeded, and a done upgrade never runs again', async () => {
    put('mypack', 'a.svg', '<svg/>');
    await make().run();
    expect(state()).toEqual({ pending: [], done: true });
    put('later', 'save.svg', '<svg/>');
    await make().run();
    expect(names()).toEqual(['later', 'mypack.bak']);
  });
});

describe('failure and retry (FR-020)', () => {
  it('logs a failed rename, retries it at the next start, and never touches a set made in between', async () => {
    put('stuck', 'a.svg', '1');
    put('fine', 'a.svg', '2');
    let fail = true;
    const flaky = {
      ...fsp,
      rename: async (from: string, to: string): Promise<void> => {
        if (fail && from.endsWith('stuck')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        return fsp.rename(from, to);
      },
    } as unknown as IconSetUpgradeDeps['fs'];

    await make({ fs: flaky }).run();
    expect(names()).toEqual(['fine.bak', 'stuck']);
    expect(state()).toEqual({ pending: ['stuck'], done: false });

    // The user makes a set after the first attempt, then the next start retries.
    put('created-later', 'save.svg', '<svg/>');
    fail = false;
    await make({ fs: flaky }).run();
    expect(names()).toEqual(['created-later', 'fine.bak', 'stuck.bak']);
    expect(state()).toEqual({ pending: [], done: true });
  });

  it('treats a pending item that has vanished as finished', async () => {
    put('gone', 'a.svg', '1');
    const first = make({
      fs: {
        ...fsp,
        // Only the folder's backup rename fails; the marker is still staged and renamed into place.
        rename: async (from: string, to: string): Promise<void> => {
          if (to === marker) return fsp.rename(from, to);
          throw new Error('boom');
        },
      } as unknown as IconSetUpgradeDeps['fs'],
    });
    await first.run();
    expect(state().pending).toEqual(['gone']);
    rmSync(join(dir, 'gone'), { recursive: true });
    await make().run();
    expect(state()).toEqual({ pending: [], done: true });
  });
});

/*
 * Review finding (2026-11-15): with no readable marker the step used to capture every folder, so a
 * configuration copied without its marker, or a marker left empty by a crash mid-write, had the
 * user's own icon sets renamed to .bak. Only a configuration from before icon sets starts the step.
 */
describe('only a configuration from before icon sets is upgraded (FR-020)', () => {
  it('marks itself done and renames nothing when there is no marker and the configuration is current', async () => {
    put('mine', 'save.svg', '<svg/>');
    await make({ predatesIconSets: false }).run();
    expect(names()).toEqual(['mine']);
    expect(state()).toEqual({ pending: [], done: true });
  });

  it('renames nothing when the marker is unreadable and the configuration is current', async () => {
    put('mine', 'save.svg', '<svg/>');
    writeFileSync(marker, '', 'utf8');
    await make({ predatesIconSets: false }).run();
    expect(names()).toEqual(['mine']);
  });

  it('leaves no staging file beside the marker', async () => {
    put('old', 'pack.json', '{}');
    await make().run();
    expect(readdirSync(root).sort()).toEqual(['icon-packs', 'icon-sets-upgrade.json']);
  });
});
