import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, DocumentStateRepository } from '@throng/persistence';

/**
 * #471 — a language override follows the FILE (016 FR-028e), including when the file moves
 * because the FOLDER holding it was renamed or moved.
 *
 * Every caller hands `movePath` the moved item's own path. For a folder that path carries no row
 * (overrides are per file), so before the fix the rows of the files beneath it stayed at their
 * old paths and never matched again.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OWNER = 'user-1';

function freshRepo(): { repo: DocumentStateRepository; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'throng-docfolder-'));
  tempDirs.push(dir);
  const db = openDatabase({ databasePath: join(dir, 'throng.db') });
  runMigrations(db);
  for (const id of ['p1', 'p2']) {
    db.prepare(
      `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, OWNER, `p-${id}`, '#123456', `C:\\src\\${id}`, '2026-01-01', '2026-01-01');
  }
  return { repo: new DocumentStateRepository(db), close: () => db.close() };
}

describe('a folder rename or move carries the overrides of the files inside it (#471)', () => {
  it('re-keys every file beneath the renamed folder, at any depth', () => {
    const { repo, close } = freshRepo();
    try {
      repo.set(OWNER, 'p1', 'folder/a.txt', 'sql');
      repo.set(OWNER, 'p1', 'folder/deep/b.zz', 'elvish');

      expect(repo.movePath(OWNER, 'p1', 'folder', 'folder2')).toBe(true);

      expect(repo.get(OWNER, 'p1', 'folder2/a.txt')?.languageId).toBe('sql');
      expect(repo.get(OWNER, 'p1', 'folder2/deep/b.zz')?.languageId).toBe('elvish');
      expect(repo.get(OWNER, 'p1', 'folder/a.txt')).toBeNull();
      expect(repo.get(OWNER, 'p1', 'folder/deep/b.zz')).toBeNull();
    } finally {
      close();
    }
  });

  it('leaves a SIBLING whose name merely starts with the folder name alone', () => {
    const { repo, close } = freshRepo();
    try {
      repo.set(OWNER, 'p1', 'folder/a.txt', 'sql');
      repo.set(OWNER, 'p1', 'folder-old/c.txt', 'go');
      repo.set(OWNER, 'p1', 'folder.txt', 'ruby');

      repo.movePath(OWNER, 'p1', 'folder', 'moved/folder');

      expect(repo.get(OWNER, 'p1', 'moved/folder/a.txt')?.languageId).toBe('sql');
      expect(repo.get(OWNER, 'p1', 'folder-old/c.txt')?.languageId).toBe('go');
      expect(repo.get(OWNER, 'p1', 'folder.txt')?.languageId).toBe('ruby');
    } finally {
      close();
    }
  });

  it('lets the moved rows win over rows already at the destination', () => {
    const { repo, close } = freshRepo();
    try {
      repo.set(OWNER, 'p1', 'folder/a.txt', 'sql');
      repo.set(OWNER, 'p1', 'dest/a.txt', 'ruby');
      repo.set(OWNER, 'p1', 'dest/stale.txt', 'go');

      repo.movePath(OWNER, 'p1', 'folder', 'dest');

      // The surviving row describes the file that now lives there. A file the move did not land
      // on (a folder MERGE keeps the destination's other files, 050 FR-007) keeps its override.
      expect(repo.get(OWNER, 'p1', 'dest/a.txt')?.languageId).toBe('sql');
      expect(repo.get(OWNER, 'p1', 'dest/stale.txt')?.languageId).toBe('go');
    } finally {
      close();
    }
  });

  it('carries a folder and its files into ANOTHER project (050 cross-project move)', () => {
    const { repo, close } = freshRepo();
    try {
      repo.set(OWNER, 'p1', 'folder/a.txt', 'sql');
      repo.set(OWNER, 'p1', 'folder/deep/b.zz', 'elvish');
      repo.set(OWNER, 'p1', 'other/c.txt', 'go');

      expect(repo.movePath(OWNER, 'p1', 'folder', 'in/folder', 'p2')).toBe(true);

      expect(repo.get(OWNER, 'p2', 'in/folder/a.txt')?.languageId).toBe('sql');
      expect(repo.get(OWNER, 'p2', 'in/folder/deep/b.zz')?.languageId).toBe('elvish');
      expect(repo.get(OWNER, 'p1', 'folder/a.txt')).toBeNull();
      expect(repo.get(OWNER, 'p1', 'other/c.txt')?.languageId).toBe('go');
    } finally {
      close();
    }
  });
});
