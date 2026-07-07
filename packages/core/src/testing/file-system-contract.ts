/**
 * Contract suite for any {@link IFileSystem} implementation (Principle V /
 * contracts/os-file-system.md). Filesystem-bound, so impls run it in the
 * integration/contract layer against a real temp directory.
 */
import { describe, it, expect } from 'vitest';
import type { IFileSystem } from '../abstractions/file-system.js';

export interface FileSystemHarness {
  fs: IFileSystem;
  /** A real, writable temp root directory (absolute, OS-form). */
  root: string;
  /** Join a POSIX-ish relative path onto `root`, returning an OS absolute path. */
  abs(rel: string): string;
  /** Create/overwrite a file (creating parent dirs). */
  write(rel: string, contents?: string): Promise<void>;
  /** Create a directory (recursive). */
  mkdir(rel: string): Promise<void>;
  /**
   * Create a symlink at `linkRel` pointing at `targetRel`. May throw on a
   * platform/permission that disallows it — the suite treats that as a skip.
   */
  symlink(targetRel: string, linkRel: string): Promise<void>;
  cleanup(): Promise<void>;
}

export function runFileSystemContract(
  name: string,
  makeHarness: () => Promise<FileSystemHarness>,
): void {
  describe(`IFileSystem contract: ${name}`, () => {
    it('lists immediate children with kind and symlink flags', async () => {
      const h = await makeHarness();
      try {
        await h.mkdir('sub');
        await h.write('sub/child.txt', 'x');
        await h.write('a.txt', 'a');
        const entries = await h.fs.list(h.root);
        const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
        expect(byName['a.txt'].kind).toBe('file');
        expect(byName['sub'].kind).toBe('folder');
        expect(byName['sub'].hasChildren).toBe(true);
        expect(byName['a.txt'].isSymlink).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('stat and realpath resolve a path', async () => {
      const h = await makeHarness();
      try {
        await h.write('f.txt', 'x');
        const s = await h.fs.stat(h.abs('f.txt'));
        expect(s.kind).toBe('file');
        const real = await h.fs.realpath(h.abs('f.txt'));
        expect(real.length).toBeGreaterThan(0);
        expect(await h.fs.exists(h.abs('f.txt'))).toBe(true);
        expect(await h.fs.exists(h.abs('missing.txt'))).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('renames a leaf in place', async () => {
      const h = await makeHarness();
      try {
        await h.write('old.txt', 'x');
        const next = await h.fs.rename(h.abs('old.txt'), 'new.txt');
        expect(await h.fs.exists(next)).toBe(true);
        expect(await h.fs.exists(h.abs('old.txt'))).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('moves a node into a destination folder', async () => {
      const h = await makeHarness();
      try {
        await h.write('f.txt', 'x');
        await h.mkdir('dest');
        const moved = await h.fs.move(h.abs('f.txt'), h.abs('dest'));
        expect(await h.fs.exists(moved)).toBe(true);
        expect(await h.fs.exists(h.abs('f.txt'))).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('copies a file and a folder recursively', async () => {
      const h = await makeHarness();
      try {
        await h.write('f.txt', 'x');
        await h.mkdir('dest');
        const copied = await h.fs.copy(h.abs('f.txt'), h.abs('dest'));
        expect(await h.fs.exists(copied)).toBe(true);
        expect(await h.fs.exists(h.abs('f.txt'))).toBe(true); // original kept

        await h.mkdir('tree/inner');
        await h.write('tree/inner/leaf.txt', 'y');
        await h.fs.copy(h.abs('tree'), h.abs('dest'));
        expect(await h.fs.exists(h.abs('dest/tree/inner/leaf.txt'))).toBe(true);
      } finally {
        await h.cleanup();
      }
    });

    it('copies under a new name when provided', async () => {
      const h = await makeHarness();
      try {
        await h.write('f.txt', 'x');
        await h.mkdir('dest');
        const copied = await h.fs.copy(h.abs('f.txt'), h.abs('dest'), 'renamed.txt');
        expect(await h.fs.exists(copied)).toBe(true);
        expect(await h.fs.exists(h.abs('dest/renamed.txt'))).toBe(true);
      } finally {
        await h.cleanup();
      }
    });

    it('creates a directory', async () => {
      const h = await makeHarness();
      try {
        await h.fs.mkdir(h.abs('fresh'));
        const s = await h.fs.stat(h.abs('fresh'));
        expect(s.kind).toBe('folder');
      } finally {
        await h.cleanup();
      }
    });

    it('permanently deletes a node', async () => {
      const h = await makeHarness();
      try {
        await h.write('gone.txt', 'x');
        await h.fs.delete(h.abs('gone.txt'));
        expect(await h.fs.exists(h.abs('gone.txt'))).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('trashes a node (removed from the live folder)', async () => {
      const h = await makeHarness();
      try {
        await h.write('trashme.txt', 'x');
        await h.fs.trash(h.abs('trashme.txt'));
        expect(await h.fs.exists(h.abs('trashme.txt'))).toBe(false);
      } finally {
        await h.cleanup();
      }
    });

    it('reports a symlink as such (or skips where unsupported)', async () => {
      const h = await makeHarness();
      try {
        await h.write('real.txt', 'x');
        let supported = true;
        try {
          await h.symlink('real.txt', 'link.txt');
        } catch {
          supported = false;
        }
        if (supported) {
          const entries = await h.fs.list(h.root);
          const link = entries.find((e) => e.name === 'link.txt');
          expect(link?.isSymlink).toBe(true);
        }
      } finally {
        await h.cleanup();
      }
    });
  });
}
