import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, ProjectCategory } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectCategoryRepository,
  ProjectRepository,
  type ThrongDatabase,
} from '@throng/persistence';

/**
 * The category store and the category-aware project store, against a real SQLite file (046;
 * FR-050, FR-054, FR-055, FR-057, FR-059; data-model §1–§2; research R9).
 *
 * Signatures pinned here (the spec names the operations, not their shapes):
 *   ProjectCategoryRepository(db)
 *     ensureDefault(ownerUser, { id, name, now }): ProjectCategory — idempotent
 *     list(ownerUser): ProjectCategory[]                          — default, then position, then id
 *     create(category: ProjectCategory): void                     — appended: the store assigns
 *                                                                   `position` one past the owner's
 *                                                                   highest, whatever was passed
 *     rename(ownerUser, id, name, now): void
 *     setMinimised(ownerUser, id, minimised, now): void
 *     deleteMerge(ownerUser, id, defaultId, orderedIds): void     — one transaction
 *     reorder(ownerUser, orderedIds): void                        — one transaction; position = index
 *                                                                   over the owner's non-default rows
 *   ProjectRepository.move(ownerUser, id, categoryId, orderedIds): void — one transaction
 *
 * 046 iterate round 1 (FR-083, FR-084; contracts/project-categories.md §5) superseded FR-056's
 * "the rest in creation order" with a user-set `position` (migration v10). The rules a caller may not
 * break — the default's id, unknown, missing or duplicated ids — are refused by core's
 * `ProjectCategoryService`; this store only writes.
 *
 * The two "one transaction" claims are proved with a trigger that aborts the LAST write, then
 * checking that the earlier writes were rolled back — a claim no amount of happy-path reading can
 * establish.
 */
const tempDirs: string[] = [];
let dbPath: string;
let db: ThrongDatabase;
let categories: ProjectCategoryRepository;
let projects: ProjectRepository;

const OWNER = 'alice';
const DEFAULT_NAME = 'In Progress';

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cats-'));
  tempDirs.push(dir);
  dbPath = join(dir, 'throng.db');
  db = openDatabase({ databasePath: dbPath });
  runMigrations(db);
  categories = new ProjectCategoryRepository(db);
  projects = new ProjectRepository(db);
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ensureDefault(owner = OWNER, id = `default-${owner}`, now = '2026-01-01T00:00:00.000Z'): ProjectCategory {
  return categories.ensureDefault(owner, { id, name: DEFAULT_NAME, now });
}

function category(id: string, createdAt: string, owner = OWNER): ProjectCategory {
  return {
    id,
    ownerUser: owner,
    name: `Cat ${id}`,
    isDefault: false,
    minimised: false,
    // Ignored by `create`, which appends (FR-084). Zero, so a store that trusted it would be caught.
    position: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

/** The owner's category ids in list order, read through `repo` (the shared one by default). */
function listedIds(owner = OWNER, repo: ProjectCategoryRepository = categories): string[] {
  return repo.list(owner).map((c) => c.id);
}

function project(id: string, owner = OWNER): Project {
  return {
    id,
    ownerUser: owner,
    name: `P ${id}`,
    colour: '#123456',
    rootFolder: `C:/src/${id}`,
    isActive: false,
    hiddenPaths: [],
    categoryId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Insert a project row by hand with an explicit category column and position. */
function rawProject(id: string, categoryId: string, position: number, owner = OWNER): void {
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at, position, category_id)
     VALUES (?, ?, ?, '#123456', ?, 0, 't', 't', ?, ?)`,
  ).run(id, owner, `P ${id}`, `C:/src/${id}`, position, categoryId);
}

function rawRows(): Array<{ id: string; position: number; category_id: string }> {
  return db
    .prepare(
      `SELECT id, position, category_id FROM projects WHERE owner_user = ? ORDER BY position ASC, id ASC`,
    )
    .all(OWNER) as Array<{ id: string; position: number; category_id: string }>;
}

describe('ProjectCategoryRepository.ensureDefault (FR-050)', () => {
  it('creates the owner\'s default once, and returns that same row on every later call', () => {
    const first = ensureDefault(OWNER, 'd-1');
    expect(first).toMatchObject({
      id: 'd-1',
      ownerUser: OWNER,
      name: DEFAULT_NAME,
      isDefault: true,
      minimised: false,
    });

    // A second call with a different candidate id must not create a second default.
    const second = ensureDefault(OWNER, 'd-2');
    expect(second.id).toBe('d-1');
    expect(categories.list(OWNER).filter((c) => c.isDefault)).toHaveLength(1);
  });

  it('is scoped per owner', () => {
    ensureDefault('alice', 'd-alice');
    ensureDefault('bob', 'd-bob');
    expect(categories.list('alice').map((c) => c.id)).toEqual(['d-alice']);
    expect(categories.list('bob').map((c) => c.id)).toEqual(['d-bob']);
  });

  it('is backed by the partial unique index: a second default row cannot be inserted', () => {
    ensureDefault();
    expect(() =>
      db
        .prepare(
          `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
           VALUES ('d-rogue', ?, 'Rogue', 1, 0, 't', 't')`,
        )
        .run(OWNER),
    ).toThrow(/UNIQUE/i);
  });
});

describe('ProjectCategoryRepository.list order (FR-056 as superseded by FR-083 / FR-084)', () => {
  it('lists the default first, then the rest in the order they were created — not by createdAt or id', () => {
    // Timestamps and ids both disagree with the call order, and the default is created LAST, so the
    // only thing that can produce this list is "default first, then append order" (FR-084). This
    // replaces the pre-v10 assertion of createdAt-then-id order, which FR-083 / FR-084 superseded.
    categories.create(category('c-late', '2026-03-01T00:00:00.000Z'));
    categories.create(category('c-early', '2026-01-01T00:00:00.000Z'));
    categories.create(category('c-tie-b', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-tie-a', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-bob', '2026-01-01T00:00:00.000Z', 'bob'));
    ensureDefault(OWNER, 'd-1', '2026-09-01T00:00:00.000Z');

    expect(listedIds()).toEqual(['d-1', 'c-late', 'c-early', 'c-tie-b', 'c-tie-a']);
  });

  it('keeps the default first whatever the positions say (FR-083)', () => {
    const def = ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-2', '2026-02-01T00:00:00.000Z'));
    // Push the default's position past everyone's, and a non-default one below zero.
    db.prepare(`UPDATE project_categories SET position = 99 WHERE id = ?`).run(def.id);
    db.prepare(`UPDATE project_categories SET position = -5 WHERE id = 'c-2'`).run();

    expect(listedIds()).toEqual([def.id, 'c-2', 'c-1']);
  });

  it('breaks a position tie by id', () => {
    const def = ensureDefault();
    categories.create(category('c-b', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-a', '2026-02-01T00:00:00.000Z'));
    db.prepare(`UPDATE project_categories SET position = 1 WHERE is_default = 0`).run();

    expect(listedIds()).toEqual([def.id, 'c-a', 'c-b']);
  });

  it('lists an empty category (FR-056)', () => {
    ensureDefault();
    categories.create(category('c-empty', '2026-02-01T00:00:00.000Z'));
    expect(categories.list(OWNER).map((c) => c.id)).toContain('c-empty');
  });
});

describe('ProjectCategoryRepository create, rename and setMinimised (FR-050, FR-051, FR-057)', () => {
  it('round-trips a created category (its position is the store\'s, not the caller\'s)', () => {
    ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    const { position, ...stored } = categories.list(OWNER).find((c) => c.id === 'c-1')!;
    const { position: _passed, ...expected } = category('c-1', '2026-02-01T00:00:00.000Z');
    expect(stored).toEqual(expected);
    expect(typeof position).toBe('number');
  });

  it('renames a category and bumps updatedAt, and can rename the default', () => {
    const def = ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    categories.rename(OWNER, 'c-1', 'Parked', '2026-04-01T00:00:00.000Z');
    categories.rename(OWNER, def.id, 'Active', '2026-04-02T00:00:00.000Z');

    const listed = categories.list(OWNER);
    expect(listed.find((c) => c.id === 'c-1')).toMatchObject({
      name: 'Parked',
      updatedAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    expect(listed.find((c) => c.id === def.id)).toMatchObject({ name: 'Active', isDefault: true });
  });

  it('persists the minimised flag across a reopen of the store (FR-057)', () => {
    ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    categories.setMinimised(OWNER, 'c-1', true, '2026-04-01T00:00:00.000Z');
    expect(categories.list(OWNER).find((c) => c.id === 'c-1')?.minimised).toBe(true);

    // A fresh repository over the same connection reads it back from the table, not a cache.
    expect(new ProjectCategoryRepository(db).list(OWNER).find((c) => c.id === 'c-1')?.minimised).toBe(true);

    categories.setMinimised(OWNER, 'c-1', false, '2026-04-02T00:00:00.000Z');
    expect(categories.list(OWNER).find((c) => c.id === 'c-1')).toMatchObject({
      minimised: false,
      updatedAt: '2026-04-02T00:00:00.000Z',
    });
  });

  it('never touches another owner\'s category of the same id', () => {
    ensureDefault('alice');
    ensureDefault('bob');
    categories.create(category('shared', '2026-02-01T00:00:00.000Z', 'bob'));
    categories.rename('alice', 'shared', 'Hijacked', '2026-04-01T00:00:00.000Z');
    categories.setMinimised('alice', 'shared', true, '2026-04-01T00:00:00.000Z');
    expect(categories.list('bob').find((c) => c.id === 'shared')).toMatchObject({
      name: 'Cat shared',
      minimised: false,
    });
  });
});

describe('ProjectCategoryRepository.deleteMerge (FR-054)', () => {
  function seedMergeFixture(): string {
    const def = ensureDefault();
    categories.create(category('c-x', '2026-02-01T00:00:00.000Z'));
    // Global order interleaves the two categories: x2, d1, x1, d2.
    rawProject('x2', 'c-x', 0);
    rawProject('d1', def.id, 1);
    rawProject('x1', 'c-x', 2);
    rawProject('d2', def.id, 3);
    return def.id;
  }

  it('moves the members to the default category, appended with their relative order kept, and deletes the row', () => {
    const defaultId = seedMergeFixture();
    // What mergeIntoDefault gives for this fixture: the default's members, then x's in their order.
    const merged = ['d1', 'd2', 'x2', 'x1'];

    categories.deleteMerge(OWNER, 'c-x', defaultId, merged);

    expect(categories.list(OWNER).map((c) => c.id)).toEqual([defaultId]);
    const rows = rawRows();
    expect(rows.map((r) => r.id)).toEqual(merged);
    expect(rows.every((r) => r.category_id === defaultId)).toBe(true);
    expect(projects.list(OWNER).map((p) => p.id)).toEqual(merged);
  });

  it('runs in one transaction: a failure deleting the row rolls back the move and the reorder', () => {
    const defaultId = seedMergeFixture();
    const before = rawRows();
    db.exec(`
      CREATE TRIGGER abort_category_delete BEFORE DELETE ON project_categories
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    expect(() => categories.deleteMerge(OWNER, 'c-x', defaultId, ['d1', 'd2', 'x2', 'x1'])).toThrow(
      /simulated failure/,
    );

    expect(rawRows()).toEqual(before);
    expect(categories.list(OWNER).map((c) => c.id)).toContain('c-x');
  });
});

describe('ProjectRepository read-time heal (R9, data-model §2)', () => {
  it('reports \'\', a dangling id and another owner\'s category all as the default category', () => {
    const def = ensureDefault('alice', 'd-alice');
    ensureDefault('bob', 'd-bob');
    categories.create(category('c-bob', '2026-02-01T00:00:00.000Z', 'bob'));
    categories.create(category('c-alice', '2026-02-01T00:00:00.000Z', 'alice'));
    rawProject('p-empty', '', 0);
    rawProject('p-dangling', 'no-such-category', 1);
    rawProject('p-foreign', 'c-bob', 2);
    rawProject('p-real', 'c-alice', 3);

    const byId = new Map(projects.list(OWNER).map((p) => [p.id, p.categoryId]));
    expect(byId.get('p-empty')).toBe(def.id);
    expect(byId.get('p-dangling')).toBe(def.id);
    expect(byId.get('p-foreign')).toBe(def.id);
    expect(byId.get('p-real')).toBe('c-alice');

    expect(projects.getById(OWNER, 'p-empty')?.categoryId).toBe(def.id);
    expect(projects.getById(OWNER, 'p-dangling')?.categoryId).toBe(def.id);
  });

  it('never reports categoryId as \'\' once a default exists', () => {
    ensureDefault();
    rawProject('p-1', '', 0);
    expect(projects.list(OWNER).every((p) => p.categoryId !== '')).toBe(true);
  });
});

describe('ProjectRepository.insert lands in the default category (FR-059)', () => {
  it('stores the owner\'s default category id on a new project, appended to the global order', () => {
    const def = ensureDefault();
    categories.create(category('c-x', '2026-02-01T00:00:00.000Z'));
    rawProject('existing', 'c-x', 0);

    projects.insert(project('new-1'));

    const row = db
      .prepare(`SELECT category_id, position FROM projects WHERE id = 'new-1'`)
      .get() as { category_id: string; position: number };
    // The raw column, not only the healed read: a new project is really IN the default category.
    expect(row.category_id).toBe(def.id);
    expect(row.position).toBe(1);
    expect(projects.getById(OWNER, 'new-1')?.categoryId).toBe(def.id);
  });
});

describe('ProjectRepository.move (FR-055)', () => {
  function seedMoveFixture(): string {
    const def = ensureDefault();
    categories.create(category('c-x', '2026-02-01T00:00:00.000Z'));
    rawProject('a', def.id, 0);
    rawProject('b', def.id, 1);
    rawProject('c', 'c-x', 2);
    return def.id;
  }

  it('sets the category and rewrites the global order', () => {
    const defaultId = seedMoveFixture();
    projects.move(OWNER, 'a', 'c-x', ['b', 'c', 'a']);

    expect(rawRows()).toEqual([
      { id: 'b', position: 0, category_id: defaultId },
      { id: 'c', position: 1, category_id: 'c-x' },
      { id: 'a', position: 2, category_id: 'c-x' },
    ]);
    expect(projects.getById(OWNER, 'a')?.categoryId).toBe('c-x');
  });

  it('runs in one transaction: a failure on the last position write rolls back the category and the earlier positions', () => {
    seedMoveFixture();
    const before = rawRows();
    // 'a' is last in orderedIds, so every other write of the move has happened before this fires.
    db.exec(`
      CREATE TRIGGER abort_move BEFORE UPDATE OF position ON projects
      WHEN NEW.id = 'a' AND NEW.position = 2
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    expect(() => projects.move(OWNER, 'a', 'c-x', ['b', 'c', 'a'])).toThrow(/simulated failure/);
    expect(rawRows()).toEqual(before);
  });

  it('touches only the calling owner\'s rows', () => {
    seedMoveFixture();
    const before = rawRows();
    ensureDefault('bob', 'd-bob');
    // Bob naming Alice's project must change nothing of Alice's: neither category nor position.
    projects.move('bob', 'b', 'd-bob', ['c', 'b']);
    expect(rawRows()).toEqual(before);
  });
});

describe('ProjectCategoryRepository.reorder (FR-083, FR-084)', () => {
  function seedFour(): string {
    const def = ensureDefault();
    for (const id of ['c-1', 'c-2', 'c-3']) categories.create(category(id, '2026-02-01T00:00:00.000Z'));
    return def.id;
  }

  it('lists the non-default categories in the new order, with the default still first', () => {
    const defaultId = seedFour();
    categories.reorder(OWNER, ['c-3', 'c-1', 'c-2']);
    expect(listedIds()).toEqual([defaultId, 'c-3', 'c-1', 'c-2']);
  });

  it('persists across a reopened database (FR-084, FR-057)', () => {
    const defaultId = seedFour();
    categories.reorder(OWNER, ['c-2', 'c-3', 'c-1']);
    db.close();

    // A new connection to the same file, and a new repository: nothing can come from memory.
    db = openDatabase({ databasePath: dbPath });
    runMigrations(db);
    expect(listedIds(OWNER, new ProjectCategoryRepository(db))).toEqual([defaultId, 'c-2', 'c-3', 'c-1']);
  });

  it('keeps each category\'s minimised state and name: a category moves with what it carries', () => {
    seedFour();
    categories.setMinimised(OWNER, 'c-1', true, '2026-04-01T00:00:00.000Z');
    categories.rename(OWNER, 'c-3', 'Parked', '2026-04-01T00:00:00.000Z');
    categories.reorder(OWNER, ['c-3', 'c-2', 'c-1']);
    const byId = new Map(categories.list(OWNER).map((c) => [c.id, c]));
    expect(byId.get('c-1')?.minimised).toBe(true);
    expect(byId.get('c-3')?.name).toBe('Parked');
  });

  it('reports the written order as each category\'s position', () => {
    seedFour();
    categories.reorder(OWNER, ['c-3', 'c-1', 'c-2']);
    const nonDefault = categories.list(OWNER).filter((c) => !c.isDefault);
    const positions = nonDefault.map((c) => c.position);
    expect(nonDefault.map((c) => c.id)).toEqual(['c-3', 'c-1', 'c-2']);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(new Set(positions).size).toBe(3);
  });

  it('runs in one transaction: a failure on the last position write rolls back the earlier ones', () => {
    seedFour();
    categories.reorder(OWNER, ['c-1', 'c-2', 'c-3']);
    const before = listedIds();
    // 'c-1' is written last, so every other write of the reorder has happened before this fires.
    db.exec(`
      CREATE TRIGGER abort_category_reorder BEFORE UPDATE OF position ON project_categories
      WHEN NEW.id = 'c-1'
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    expect(() => categories.reorder(OWNER, ['c-3', 'c-2', 'c-1'])).toThrow(/simulated failure/);
    expect(listedIds()).toEqual(before);
  });

  it('touches only the calling owner\'s rows', () => {
    seedFour();
    ensureDefault('bob', 'd-bob');
    // Bob naming Alice's category ids must change nothing of hers.
    const before = listedIds();
    categories.reorder('bob', ['c-3', 'c-2', 'c-1']);
    expect(listedIds()).toEqual(before);
  });
});

describe('ProjectCategoryRepository.create appends (FR-084)', () => {
  it('lands a new category after every existing one, even after a reorder', () => {
    const def = ensureDefault();
    for (const id of ['c-1', 'c-2', 'c-3']) categories.create(category(id, '2026-02-01T00:00:00.000Z'));
    categories.reorder(OWNER, ['c-3', 'c-1', 'c-2']);

    // Created with the EARLIEST timestamp and the lowest id, so neither can put it last.
    categories.create(category('a-new', '2000-01-01T00:00:00.000Z'));

    expect(listedIds()).toEqual([def.id, 'c-3', 'c-1', 'c-2', 'a-new']);
    const listed = categories.list(OWNER).filter((c) => !c.isDefault);
    const newPosition = listed.find((c) => c.id === 'a-new')!.position;
    for (const other of listed.filter((c) => c.id !== 'a-new')) {
      expect(newPosition).toBeGreaterThan(other.position);
    }
  });

  it('appends past positions that are not contiguous (one past the highest, not the count)', () => {
    const def = ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-2', '2026-02-01T00:00:00.000Z'));
    db.prepare(`UPDATE project_categories SET position = 40 WHERE id = 'c-1'`).run();
    db.prepare(`UPDATE project_categories SET position = 7 WHERE id = 'c-2'`).run();

    categories.create(category('c-3', '2026-02-01T00:00:00.000Z'));

    expect(listedIds()).toEqual([def.id, 'c-2', 'c-1', 'c-3']);
  });

  it('appends per owner: another owner\'s positions do not move this owner\'s new category', () => {
    ensureDefault('bob', 'd-bob');
    categories.create(category('b-1', '2026-02-01T00:00:00.000Z', 'bob'));
    db.prepare(`UPDATE project_categories SET position = 500 WHERE id = 'b-1'`).run();
    const def = ensureDefault();
    categories.create(category('c-1', '2026-02-01T00:00:00.000Z'));
    categories.create(category('c-2', '2026-02-01T00:00:00.000Z'));

    expect(listedIds()).toEqual([def.id, 'c-1', 'c-2']);
    expect(listedIds('bob')).toEqual(['d-bob', 'b-1']);
  });
});
