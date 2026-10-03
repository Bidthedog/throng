import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileClipboard } from '@throng/core';
import { FileClipboardService } from '../../src/main/file-clipboard.js';

/**
 * The application's ONE File Explorer clipboard (050 R1, FR-001 – FR-003, FR-007 – FR-011).
 *
 * Held by main, keyed by ABSOLUTE path, pushed to every window on each change — and on no other
 * occasion, so a window re-renders only when there is something new to show.
 */

const ROOT_A = join('C:', 'work', 'alpha');
const ROOT_B = join('C:', 'work', 'beta');

let pushed: FileClipboard[];
let svc: FileClipboardService;

beforeEach(() => {
  pushed = [];
  svc = new FileClipboardService((c) => pushed.push(c));
});

describe('FileClipboardService (050 R1)', () => {
  it('setFromRelative stores ABSOLUTE items and broadcasts once', () => {
    expect(svc.setFromRelative('cut', ['a.txt', 'dir'], ROOT_A, 'A')).toEqual({ ok: true });
    const expected: FileClipboard = {
      mode: 'cut',
      items: [
        { absPath: join(ROOT_A, 'a.txt'), projectId: 'A', projectRoot: ROOT_A },
        { absPath: join(ROOT_A, 'dir'), projectId: 'A', projectRoot: ROOT_A },
      ],
    };
    expect(svc.get()).toEqual(expected);
    expect(pushed).toEqual([expected]);
  });

  it('refuses the root row, a path escaping the root, and an empty selection — changing nothing', () => {
    expect(svc.setFromRelative('copy', [''], ROOT_A, 'A')).toHaveProperty('error');
    expect(svc.setFromRelative('copy', ['../beta/x.txt'], ROOT_A, 'A')).toHaveProperty('error');
    expect(svc.setFromRelative('copy', [], ROOT_A, 'A')).toHaveProperty('error');
    expect(svc.get()).toBeNull();
    expect(pushed).toEqual([]);
  });

  it('a second cut or copy REPLACES the first (FR-003)', () => {
    svc.setFromRelative('cut', ['a.txt'], ROOT_A, 'A');
    svc.setFromRelative('copy', ['b.txt'], ROOT_B, 'B');
    expect(svc.get()).toEqual({
      mode: 'copy',
      items: [{ absPath: join(ROOT_B, 'b.txt'), projectId: 'B', projectRoot: ROOT_B }],
    });
  });

  it('clear broadcasts null, and clearing an empty clipboard broadcasts nothing', () => {
    svc.clear();
    expect(pushed).toEqual([]);
    svc.setFromRelative('copy', ['a.txt'], ROOT_A, 'A');
    svc.clear();
    expect(svc.get()).toBeNull();
    expect(pushed.at(-1)).toBeNull();
    expect(pushed).toHaveLength(2);
  });

  it('followMoves rewrites a pending item (or one under a moved folder) and broadcasts only on change', () => {
    svc.setFromRelative('cut', [join('docs', 'a.txt'), 'b.txt'], ROOT_A, 'A');
    pushed = [];
    svc.followMoves([{ from: join(ROOT_A, 'unrelated'), to: join(ROOT_A, 'elsewhere') }]);
    expect(pushed).toEqual([]);
    svc.followMoves([{ from: join(ROOT_A, 'docs'), to: join(ROOT_A, 'manual') }]);
    expect(svc.get()?.items.map((i) => i.absPath)).toEqual([
      join(ROOT_A, 'manual', 'a.txt'),
      join(ROOT_A, 'b.txt'),
    ]);
    expect(pushed).toHaveLength(1);
  });

  it('dropDeleted drops a deleted item, empties to null, and broadcasts only on change', () => {
    svc.setFromRelative('copy', ['a.txt'], ROOT_A, 'A');
    pushed = [];
    svc.dropDeleted([join(ROOT_A, 'other.txt')]);
    expect(pushed).toEqual([]);
    svc.dropDeleted([join(ROOT_A, 'a.txt')]);
    expect(svc.get()).toBeNull();
    expect(pushed).toEqual([null]);
  });

  it('retainProjects empties the clipboard when its project is gone or re-rooted (FR-011)', () => {
    svc.setFromRelative('copy', ['a.txt'], ROOT_A, 'A');
    pushed = [];
    svc.retainProjects(new Map([['A', ROOT_A], ['B', ROOT_B]]));
    expect(pushed).toEqual([]);
    svc.retainProjects(new Map([['A', join('D:', 'moved', 'alpha')]]));
    expect(svc.get()).toBeNull();
    expect(pushed).toEqual([null]);

    svc.setFromRelative('copy', ['a.txt'], ROOT_A, 'A');
    svc.retainProjects(new Map([['B', ROOT_B]]));
    expect(svc.get()).toBeNull();
  });

  it('afterRun keeps what did not move, only while the clipboard is still the run’s snapshot', () => {
    svc.setFromRelative('cut', ['a.txt', 'b.txt'], ROOT_A, 'A');
    const snapshot = svc.get();
    const b = snapshot!.items[1]!;
    pushed = [];
    svc.afterRun(snapshot, [b]);
    expect(svc.get()).toEqual({ mode: 'cut', items: [b] });
    expect(pushed).toHaveLength(1);

    // The user replaced the clipboard while a run went on: the run leaves it alone.
    svc.setFromRelative('copy', ['c.txt'], ROOT_A, 'A');
    const replaced = svc.get();
    pushed = [];
    svc.afterRun(snapshot, []);
    expect(svc.get()).toEqual(replaced);
    expect(pushed).toEqual([]);
  });

  it('is never persisted and never touches the OS clipboard (FR-007, FR-008)', async () => {
    // The service's only dependency is the broadcaster; this pins that it stays that way.
    const here = fileURLToPath(new URL('.', import.meta.url));
    const source = await readFile(join(here, '../../src/main/file-clipboard.ts'), 'utf8');
    const imports = source.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(imports.join('\n')).not.toMatch(/clipboard-service|electron|daemon|repository|config-store|node:fs/);
  });
});
