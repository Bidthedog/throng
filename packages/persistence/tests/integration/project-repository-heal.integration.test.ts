import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, ProjectRepository, type ThrongDatabase } from '@throng/persistence';

/**
 * 068 FR-034e — a project row with no id is given one, saved by `rowid`.
 *
 * Layer: integration — `projects.id` is `TEXT PRIMARY KEY` with no NOT NULL, so a null or empty id is
 * only reachable (and only healable) in a real SQLite file; the update must address the row by
 * `rowid` because the id is exactly what it lacks.
 */
let dir: string;
let db: ThrongDatabase;
let repo: ProjectRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-proj-heal-'));
  db = openDatabase({ databasePath: join(dir, 'throng.db') });
  runMigrations(db);
  repo = new ProjectRepository(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const insertRaw = (id: string | null, root: string): void => {
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, hidden_paths, search_exclude_globs,
                           created_at, updated_at, position, category_id)
     VALUES (?, 'alice', 'n', '#fff', ?, 0, '[]', '[]', '2026-01-01', '2026-01-01', 0, '')`,
  ).run(id, root);
};

describe('ProjectRepository.assignMissingIds', () => {
  it('gives a null and an empty id each a new one, by rowid, and leaves the rest alone', () => {
    insertRaw(null, 'C:/a');
    insertRaw('', 'C:/b');
    insertRaw('keep', 'C:/c');
    let n = 0;
    expect(repo.assignMissingIds('alice', () => `new-${(n += 1)}`)).toBe(2);
    const ids = repo.list('alice').map((p) => p.id).sort();
    expect(ids).toEqual(['keep', 'new-1', 'new-2']);
    // Stable: nothing is left to heal, so a second pass mints nothing.
    expect(repo.assignMissingIds('alice', () => `new-${(n += 1)}`)).toBe(0);
    expect(n).toBe(2);
  });
});
