// Layer: integration. What the walk counts, follows and skips is only true of a real tree.
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFileAttributes, FakeOsPropertiesDialog, skipUnlessLinux, FakeFileAccessInfo } from '@throng/core/testing';
import type { FolderTally } from '@throng/core';
import { PropertiesService } from '../../src/main/properties-service.js';

let root: string;
let now: number;
let service: PropertiesService;
const dialog = new FakeOsPropertiesDialog();

function tallies() {
  const seen: FolderTally[] = [];
  let settle!: (tally: FolderTally) => void;
  const finished = new Promise<FolderTally>((resolve) => (settle = resolve));
  return {
    seen,
    finished,
    emit: (_requestId: string, tally: FolderTally): void => {
      seen.push(tally);
      if (tally.done) settle(tally);
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-properties-'));
  mkdirSync(join(root, 'dir/sub'), { recursive: true });
  writeFileSync(join(root, 'dir/a.txt'), '12345');
  writeFileSync(join(root, 'dir/sub/b.txt'), '123');
  writeFileSync(join(root, 'c.txt'), '1234567');
  now = 1000;
  service = new PropertiesService(new FakeFileAttributes(), dialog, new FakeFileAccessInfo(), () => root, () => now);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PropertiesService (067 FR-046 to FR-054)', () => {
  it('answers what it knows at once, before any walking', async () => {
    const t = tallies();
    const opened = await service.open(['dir'], t.emit);
    expect(t.seen).toEqual([]);
    expect(opened.items[0]).toMatchObject({ name: 'dir', path: join(root, 'dir'), type: 'folder' });
    expect(opened.osProperties.available).toBe(true);
  });

  it('totals a folder, not counting the folder itself', async () => {
    const t = tallies();
    await service.open(['dir'], t.emit);
    expect(await t.finished).toEqual({ sizeBytes: 8, files: 2, folders: 1, skipped: 0, done: true });
  });

  it('combines a multi-selection, counting the selected folder', async () => {
    const t = tallies();
    await service.open(['dir', 'c.txt'], t.emit);
    expect(await t.finished).toEqual({ sizeBytes: 15, files: 3, folders: 2, skipped: 0, done: true });
  });

  it('reports a deleted item as gone', async () => {
    const t = tallies();
    expect((await service.open(['missing'], t.emit)).items[0]).toMatchObject({ gone: true });
  });

  it('refuses a path outside the project', async () => {
    const t = tallies();
    expect((await service.open(['../elsewhere'], t.emit)).items).toEqual([]);
  });

  it('reuses a result within 60 seconds and walks again after', async () => {
    const first = tallies();
    await service.open(['dir'], first.emit);
    await first.finished;
    writeFileSync(join(root, 'dir/new.txt'), '1');

    now += 59_000;
    const cached = tallies();
    await service.open(['dir'], cached.emit);
    expect((await cached.finished).files).toBe(2);

    now += 2_000;
    const fresh = tallies();
    await service.open(['dir'], fresh.emit);
    expect((await fresh.finished).files).toBe(3);
  });

  it('stops when closed, and caches nothing partial', async () => {
    const t = tallies();
    const { requestId } = await service.open(['dir'], t.emit);
    service.close(requestId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.seen.some((tally) => tally.done)).toBe(false);
    const again = tallies();
    await service.open(['dir'], again.emit);
    expect((await again.finished).files).toBe(2);
  });

  it('reports an item deleted while the dialog is open, once, and stops', async () => {
    const watching = new PropertiesService(new FakeFileAttributes(), dialog, new FakeFileAccessInfo(), () => root, () => now, 10);
    const t = tallies();
    await watching.open(['c.txt'], t.emit);
    await t.finished;
    rmSync(join(root, 'c.txt'));
    await vi.waitFor(() => expect(t.seen.at(-1)?.gone).toEqual([join(root, 'c.txt')]), { timeout: 2000 });
    const count = t.seen.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(t.seen.length).toBe(count);
  });

  it('stops watching once closed', async () => {
    const watching = new PropertiesService(new FakeFileAttributes(), dialog, new FakeFileAccessInfo(), () => root, () => now, 10);
    const t = tallies();
    const { requestId } = await watching.open(['c.txt'], t.emit);
    await t.finished;
    watching.close(requestId);
    rmSync(join(root, 'c.txt'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(t.seen.some((tally) => tally.gone)).toBe(false);
  });

  it('opens the OS dialog only inside the project', async () => {
    expect(await service.showOsProperties(join(root, 'c.txt'))).toEqual({ ok: true });
    expect(dialog.shown).toEqual([join(root, 'c.txt')]);
    expect(await service.showOsProperties('/elsewhere/x')).toHaveProperty('error');
  });
});

describe.skipIf(skipUnlessLinux('symlinks and mode bits behave this way on Linux only'))('the walk on Linux (067 FR-051)', () => {
  it('counts a link as one entry and never follows it', async () => {
    symlinkSync(join(root, 'dir'), join(root, 'dir/sub/loop'));
    const t = tallies();
    await service.open(['dir'], t.emit);
    expect(await t.finished).toMatchObject({ files: 3, folders: 1, skipped: 0 });
  });

  it('describes a link and its target', async () => {
    symlinkSync(join(root, 'c.txt'), join(root, 'link'));
    const t = tallies();
    expect((await service.open(['link'], t.emit)).items[0]).toMatchObject({ type: 'symlink', linkTarget: join(root, 'c.txt') });
  });

  it('counts an unreadable folder as skipped rather than failing', async () => {
    chmodSync(join(root, 'dir/sub'), 0);
    try {
      const t = tallies();
      await service.open(['dir'], t.emit);
      expect(await t.finished).toMatchObject({ files: 1, folders: 1, skipped: 1 });
    } finally {
      chmodSync(join(root, 'dir/sub'), 0o755);
    }
  });
});

describe('a large tree (067 SC-007)', () => {
  it('finishes within the budget, grows monotonically and leaves the event loop free', { timeout: 90_000 }, async () => {
    for (let d = 0; d < 100; d++) {
      const folder = join(root, 'big', String(d));
      mkdirSync(folder, { recursive: true });
      for (let f = 0; f < 1000; f++) closeSync(openSync(join(folder, String(f)), 'w'));
    }
    let worstGap = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const at = performance.now();
      worstGap = Math.max(worstGap, at - last);
      last = at;
    }, 5);
    vi.useRealTimers();
    const t = tallies();
    const started = performance.now();
    await service.open(['big'], t.emit);
    const result = await t.finished;
    clearInterval(ticker);
    expect(result).toMatchObject({ files: 100_000, folders: 100 });
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(worstGap).toBeLessThan(100);
    const counts = t.seen.map((tally) => tally.files);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.length).toBeGreaterThan(1);
  });

  it('carries the item\'s access details (FR-121)', async () => {
    const access = new FakeFileAccessInfo({ owner: 'alice', group: 'staff', modeSymbolic: 'rw-r--r--', modeOctal: '0644' });
    writeFileSync(join(root, 'access.txt'), 'x');
    const svc = new PropertiesService(new FakeFileAttributes(), new FakeOsPropertiesDialog(), access, () => root);
    const opened = await svc.open(['access.txt'], () => {});
    expect(opened.items[0]!.access).toEqual({ owner: 'alice', group: 'staff', modeSymbolic: 'rw-r--r--', modeOctal: '0644' });
    svc.close(opened.requestId);
  });
});
