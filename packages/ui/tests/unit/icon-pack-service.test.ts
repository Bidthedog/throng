import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 017 / #54 — the main process loads every pack asset ONCE, into memory.
 *
 * This is not an optimisation, it is a requirement (FR-006a). The file explorer resolves an icon
 * PER ROW, so if rendering an icon could reach the disk, painting a large tree would perform
 * hundreds of reads for a single frame. The renderer therefore never receives a path — only
 * already-loaded assets — and `assetBase` is deliberately not exposed to it.
 */

// Count the real reads. `importOriginal` keeps the actual fs behaviour; we only observe it.
const readCounts = new Map<string, number>();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn((path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      const key = String(path);
      readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
      return (actual.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    }),
  };
});

const { IconPackService } = await import('../../src/main/icon-pack-service.js');

let root: string;

beforeEach(() => {
  readCounts.clear();
  root = mkdtempSync(join(tmpdir(), 'throng-packs-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePack(name: string, manifest: unknown, files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) {
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(manifest), 'utf8');
  }
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content, 'utf8');
  }
  return dir;
}

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0" stroke="currentColor"/></svg>';

describe('IconPackService.listIconPacks — asset loading', () => {
  it('reads each asset EXACTLY ONCE', async () => {
    const dir = writePack(
      'p',
      { name: 'p', tokens: { folder: 'folder.svg', file: 'file.svg' } },
      { 'folder.svg': SVG, 'file.svg': SVG },
    );

    const packs = await new IconPackService(root).listIconPacks();

    expect(packs).toHaveLength(1);
    expect(readCounts.get(join(dir, 'folder.svg'))).toBe(1);
    expect(readCounts.get(join(dir, 'file.svg'))).toBe(1);
  });

  it('returns sanitised inline MARKUP, not a path', async () => {
    // A path would be useless: the renderer must not touch the disk, and an SVG behind a file:// URL
    // in an <img> cannot inherit the theme's colour anyway — which is the whole bug (#54).
    writePack(
      'p',
      { name: 'p', tokens: { folder: 'folder.svg' } },
      { 'folder.svg': `<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M1 2" stroke="currentColor"/></svg>` },
    );

    const [pack] = await new IconPackService(root).listIconPacks();

    expect(pack.assets.folder).toEqual({
      kind: 'svg',
      markup: expect.stringContaining('stroke="currentColor"'),
    });
    const asset = pack.assets.folder;
    expect(asset.kind).toBe('svg');
    if (asset.kind === 'svg') {
      expect(asset.markup).not.toContain('script'); // sanitised before it ever crosses IPC
      expect(asset.markup).toContain('d="M1 2"');
    }
  });

  it('does NOT expose assetBase to the renderer', async () => {
    writePack('p', { name: 'p', tokens: { folder: 'folder.svg' } }, { 'folder.svg': SVG });
    const [pack] = await new IconPackService(root).listIconPacks();
    expect(pack).not.toHaveProperty('assetBase');
  });

  it('a token whose file is missing becomes `missing`, not a crash', async () => {
    writePack('p', { name: 'p', tokens: { folder: 'nope.svg' } }); // no such file
    const [pack] = await new IconPackService(root).listIconPacks();
    expect(pack.assets.folder).toEqual({ kind: 'missing' });
    expect(pack.error).toBeUndefined(); // the PACK is fine; one token is not
  });

  it('a file that is not an SVG becomes `missing`, not injected markup', async () => {
    writePack('p', { name: 'p', tokens: { folder: 'folder.svg' } }, { 'folder.svg': '<html>nope</html>' });
    const [pack] = await new IconPackService(root).listIconPacks();
    expect(pack.assets.folder).toEqual({ kind: 'missing' });
  });

  it('a PNG token becomes a data URI (it cannot be themed, but it can be shown)', async () => {
    writePack('p', { name: 'p', tokens: { folder: 'folder.png' } }, { 'folder.png': 'PNGDATA' });
    const [pack] = await new IconPackService(root).listIconPacks();
    const asset = pack.assets.folder;
    expect(asset.kind).toBe('raster');
    if (asset.kind === 'raster') expect(asset.dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('glyph tokens need no disk read at all', async () => {
    writePack('p', { name: 'p', tokens: { folder: '📁' } });
    const [pack] = await new IconPackService(root).listIconPacks();
    expect(pack.assets.folder).toEqual({ kind: 'glyph', glyph: '📁' });
  });
});

describe('IconPackService.listIconPacks — a broken pack degrades, it does not crash (FR-004a)', () => {
  it('reports a pack with no manifest as unavailable, WITH a reason', async () => {
    writePack('broken', undefined); // directory exists, pack.json does not
    const packs = await new IconPackService(root).listIconPacks();

    const broken = packs.find((p) => p.name === 'broken');
    expect(broken).toBeDefined();
    // The pack must still be LISTED — silently omitting it reproduces the exact confusion this
    // feature exists to remove: a setting that appears to do nothing.
    expect(broken!.error).toBeTruthy();
    expect(broken!.assets).toEqual({});
  });

  it('reports a pack with an unparseable manifest as unavailable, WITH a reason', async () => {
    const dir = join(root, 'bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pack.json'), '{ not json', 'utf8');

    const [pack] = await new IconPackService(root).listIconPacks();
    expect(pack.name).toBe('bad');
    expect(pack.error).toBeTruthy();
  });

  it('one broken pack does not stop the others loading', async () => {
    writePack('broken', undefined);
    writePack('good', { name: 'good', tokens: { folder: 'folder.svg' } }, { 'folder.svg': SVG });

    const packs = await new IconPackService(root).listIconPacks();
    const good = packs.find((p) => p.name === 'good');
    expect(good?.error).toBeUndefined();
    expect(good?.assets.folder.kind).toBe('svg');
  });

  it('never throws, even when the packs directory does not exist', async () => {
    await expect(new IconPackService(join(root, 'nonexistent')).listIconPacks()).resolves.toEqual([]);
  });
});
