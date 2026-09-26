import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectCategoryService, ProjectService, type IUserContext } from '@throng/core';
import { JSON_RPC_INVALID_PARAMS, type JsonRpcResponse } from '@throng/ipc-contract';
import {
  openDatabase,
  runMigrations,
  ProjectCategoryRepository,
  ProjectRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { RpcRouter } from '../../src/rpc-router.js';
import { ProjectIpcService } from '../../src/project-service.js';

/**
 * The six category RPCs and the category-aware `projects.list`, driven through the daemon's own
 * router over a real SQLite file (046; FR-050 – FR-057; contracts/project-categories.md §1).
 *
 * Every refusal in §1 is an `RpcError` with `JSON_RPC_INVALID_PARAMS` — including an unknown id,
 * which is why these assert -32602 where `projects.setActive` answers -32004 for the same thing.
 * Each refusal must also carry a message, because the renderer presents it through `fail(...)`
 * (030): a refusal with no cause is a swallowed failure.
 *
 * Method names are spelled as the wire carries them rather than through the contract's constants,
 * so a renamed constant cannot silently rename the wire method.
 */
const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let db: ThrongDatabase;
let dataDir: string;
let router: RpcRouter;

/**
 * The ONE place this file assumes how the services are assembled. It mirrors what T020 binds in
 * `composition-root.ts`: the category repository and service, injected into `ProjectIpcService` by
 * constructor beside its existing collaborators.
 */
function buildRouter(database: ThrongDatabase): RpcRouter {
  const store = new ProjectRepository(database);
  const categoryStore = new ProjectCategoryRepository(database);
  const newId = (): string => randomUUID();
  const now = (): string => new Date().toISOString();
  const projectService = new ProjectService({ store, categories: categoryStore, userContext, newId, now });
  const categoryService = new ProjectCategoryService({
    store: categoryStore,
    projectStore: store,
    userContext,
    newId,
    now,
  });
  const r = new RpcRouter();
  new ProjectIpcService(projectService, undefined, undefined, undefined, categoryService).register(r);
  return r;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-categories-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  router = buildRouter(db);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let rpcId = 0;
async function call(method: string, params?: unknown): Promise<JsonRpcResponse> {
  return router.handle({ jsonrpc: '2.0', id: ++rpcId, method, params });
}

/** The result of a call that must succeed; fails the test with the RPC error otherwise. */
async function ok<T = Record<string, any>>(method: string, params?: unknown): Promise<T> {
  const response = (await call(method, params)) as { result?: T; error?: { message: string } };
  if (response.error) throw new Error(`${method} refused: ${response.error.message}`);
  return response.result as T;
}

/** A call that must be refused with -32602 and a presentable message. */
async function expectRefused(method: string, params: unknown): Promise<void> {
  const response = (await call(method, params)) as {
    result?: unknown;
    error?: { code: number; message: string };
  };
  expect(response.result, `${method} ${JSON.stringify(params)} should be refused`).toBeUndefined();
  expect(response.error?.code).toBe(JSON_RPC_INVALID_PARAMS);
  expect(response.error?.message.trim().length ?? 0).toBeGreaterThan(0);
}

interface CategoryDto {
  id: string;
  name: string;
  isDefault: boolean;
  minimised: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectLite {
  id: string;
  categoryId: string;
}

const DTO_KEYS = ['createdAt', 'id', 'isDefault', 'minimised', 'name', 'position', 'updatedAt'];

function expectCategoryShape(dto: CategoryDto): void {
  expect(Object.keys(dto).sort()).toEqual(DTO_KEYS);
  expect(typeof dto.id).toBe('string');
  expect(dto.id.length).toBeGreaterThan(0);
  expect(typeof dto.name).toBe('string');
  expect(typeof dto.isDefault).toBe('boolean');
  expect(typeof dto.minimised).toBe('boolean');
  expect(typeof dto.position).toBe('number');
  expect(typeof dto.createdAt).toBe('string');
  expect(typeof dto.updatedAt).toBe('string');
}

async function listCategories(): Promise<CategoryDto[]> {
  return (await ok<{ categories: CategoryDto[] }>('projects.categories.list')).categories;
}

async function defaultCategory(): Promise<CategoryDto> {
  const found = (await listCategories()).find((c) => c.isDefault);
  if (!found) throw new Error('no default category listed');
  return found;
}

async function createCategory(name: string): Promise<CategoryDto> {
  return (await ok<{ category: CategoryDto }>('projects.categories.create', { name })).category;
}

async function listProjects(): Promise<ProjectLite[]> {
  return (await ok<{ projects: ProjectLite[] }>('projects.list')).projects;
}

let folder = 0;
async function createProject(name: string): Promise<ProjectLite> {
  folder += 1;
  return (
    await ok<{ project: ProjectLite }>('projects.create', {
      name,
      colour: '#6aa3ff',
      rootFolder: `C:/code/cat-${process.pid}-${folder}`,
    })
  ).project;
}

describe('projects.categories.list', () => {
  it('returns the default "In Progress" category for a fresh owner, in the DTO shape', async () => {
    const categories = await listCategories();
    expect(categories).toHaveLength(1);
    expectCategoryShape(categories[0]);
    expect(categories[0]).toMatchObject({ name: 'In Progress', isDefault: true, minimised: false });
  });

  it('lists the default first, then the rest in creation order, including empty ones', async () => {
    const a = await createCategory('Alpha');
    const b = await createCategory('Beta');
    const listed = await listCategories();
    expect(listed.map((c) => c.isDefault)).toEqual([true, false, false]);
    expect(listed.slice(1).map((c) => c.id)).toEqual([a.id, b.id]);
  });
});

describe('projects.categories.create', () => {
  it('returns { category } with the trimmed name, not default, not minimised', async () => {
    const created = await createCategory('  Later  ');
    expectCategoryShape(created);
    expect(created).toMatchObject({ name: 'Later', isDefault: false, minimised: false });
    expect((await listCategories()).at(-1)?.id).toBe(created.id);
  });

  it('refuses an empty name, a whitespace-only name, and a missing or non-string name', async () => {
    await expectRefused('projects.categories.create', { name: '' });
    await expectRefused('projects.categories.create', { name: '   ' });
    await expectRefused('projects.categories.create', {});
    await expectRefused('projects.categories.create', { name: 42 });
    expect(await listCategories()).toHaveLength(1);
  });

  it('refuses a name that duplicates another ignoring case — the default\'s too', async () => {
    await createCategory('Later');
    await expectRefused('projects.categories.create', { name: 'LATER' });
    await expectRefused('projects.categories.create', { name: '  later ' });
    await expectRefused('projects.categories.create', { name: 'in progress' });
    expect(await listCategories()).toHaveLength(2);
  });
});

describe('projects.categories.rename', () => {
  it('returns { category } with the new trimmed name, and renames the default too (FR-050)', async () => {
    const later = await createCategory('Later');
    const renamed = (
      await ok<{ category: CategoryDto }>('projects.categories.rename', { id: later.id, name: ' Parked ' })
    ).category;
    expectCategoryShape(renamed);
    expect(renamed).toMatchObject({ id: later.id, name: 'Parked' });

    const def = await defaultCategory();
    const renamedDefault = (
      await ok<{ category: CategoryDto }>('projects.categories.rename', { id: def.id, name: 'Active' })
    ).category;
    expect(renamedDefault).toMatchObject({ id: def.id, name: 'Active', isDefault: true });
    expect((await listCategories()).map((c) => c.name)).toEqual(['Active', 'Parked']);
  });

  it('allows a category to change only the case of its own name', async () => {
    const later = await createCategory('Later');
    const renamed = (
      await ok<{ category: CategoryDto }>('projects.categories.rename', { id: later.id, name: 'LATER' })
    ).category;
    expect(renamed.name).toBe('LATER');
  });

  it('refuses an empty name, a case-insensitive duplicate of another, and an unknown id', async () => {
    const later = await createCategory('Later');
    await createCategory('Someday');
    await expectRefused('projects.categories.rename', { id: later.id, name: '  ' });
    await expectRefused('projects.categories.rename', { id: later.id, name: 'someday' });
    await expectRefused('projects.categories.rename', { id: later.id, name: 'IN PROGRESS' });
    await expectRefused('projects.categories.rename', { id: 'no-such-category', name: 'Fine' });
    await expectRefused('projects.categories.rename', { name: 'Fine' });
    expect((await listCategories()).map((c) => c.name)).toEqual(['In Progress', 'Later', 'Someday']);
  });
});

describe('projects.categories.setMinimised', () => {
  it('returns { category } with the flag, and the list keeps it (FR-051, FR-057)', async () => {
    const later = await createCategory('Later');
    const minimised = (
      await ok<{ category: CategoryDto }>('projects.categories.setMinimised', {
        id: later.id,
        minimised: true,
      })
    ).category;
    expectCategoryShape(minimised);
    expect(minimised).toMatchObject({ id: later.id, minimised: true });
    expect((await listCategories()).find((c) => c.id === later.id)?.minimised).toBe(true);

    // A second router over the same database stands in for a daemon restart.
    router = buildRouter(db);
    expect((await listCategories()).find((c) => c.id === later.id)?.minimised).toBe(true);

    const expanded = (
      await ok<{ category: CategoryDto }>('projects.categories.setMinimised', {
        id: later.id,
        minimised: false,
      })
    ).category;
    expect(expanded.minimised).toBe(false);
  });

  it('refuses the default category and an unknown id', async () => {
    const def = await defaultCategory();
    await expectRefused('projects.categories.setMinimised', { id: def.id, minimised: true });
    await expectRefused('projects.categories.setMinimised', { id: 'no-such-category', minimised: true });
    expect((await defaultCategory()).minimised).toBe(false);
  });
});

describe('projects.categories.delete (FR-054)', () => {
  it('returns { movedProjectIds }, moves the members to the default after its own, and drops the row', async () => {
    const def = await defaultCategory();
    const parked = await createCategory('Parked');
    const a = await createProject('A');
    const x1 = await createProject('X1');
    const b = await createProject('B');
    const x2 = await createProject('X2');
    // Order a, x1, b, x2; x1 and x2 move into Parked keeping that order.
    await ok('projects.move', { id: x1.id, categoryId: parked.id, orderedIds: [a.id, x1.id, b.id, x2.id] });
    await ok('projects.move', { id: x2.id, categoryId: parked.id, orderedIds: [a.id, x1.id, b.id, x2.id] });

    const result = await ok<{ movedProjectIds: string[] }>('projects.categories.delete', { id: parked.id });
    expect(Object.keys(result)).toEqual(['movedProjectIds']);
    expect([...result.movedProjectIds].sort()).toEqual([x1.id, x2.id].sort());

    expect((await listCategories()).map((c) => c.id)).toEqual([def.id]);
    const projects = await listProjects();
    expect(projects.map((p) => p.id)).toEqual([a.id, b.id, x1.id, x2.id]);
    expect(projects.every((p) => p.categoryId === def.id)).toBe(true);
  });

  it('deletes an empty category with an empty movedProjectIds', async () => {
    const empty = await createCategory('Empty');
    const result = await ok<{ movedProjectIds: string[] }>('projects.categories.delete', { id: empty.id });
    expect(result.movedProjectIds).toEqual([]);
    expect(await listCategories()).toHaveLength(1);
  });

  it('refuses the default category and an unknown id', async () => {
    const def = await defaultCategory();
    await expectRefused('projects.categories.delete', { id: def.id });
    await expectRefused('projects.categories.delete', { id: 'no-such-category' });
    await expectRefused('projects.categories.delete', {});
    expect((await listCategories()).map((c) => c.id)).toEqual([def.id]);
  });
});

describe('projects.categories.reorder (FR-083, FR-084; contracts/project-categories.md §5)', () => {
  it('returns { categories } in the new order, the default first, and the list keeps it', async () => {
    const def = await defaultCategory();
    const a = await createCategory('Alpha');
    const b = await createCategory('Beta');
    const c = await createCategory('Gamma');

    const result = await ok<{ categories: CategoryDto[] }>('projects.categories.reorder', {
      orderedIds: [c.id, a.id, b.id],
    });
    expect(Object.keys(result)).toEqual(['categories']);
    result.categories.forEach(expectCategoryShape);
    expect(result.categories.map((cat) => cat.id)).toEqual([def.id, c.id, a.id, b.id]);
    expect((await listCategories()).map((cat) => cat.id)).toEqual([def.id, c.id, a.id, b.id]);

    // A category created afterwards is appended (FR-084).
    const d = await createCategory('Delta');
    expect((await listCategories()).map((cat) => cat.id)).toEqual([def.id, c.id, a.id, b.id, d.id]);
  });

  it('refuses the default\'s id, an unknown, missing or duplicated id, and a non-string array', async () => {
    const def = await defaultCategory();
    const a = await createCategory('Alpha');
    const b = await createCategory('Beta');
    const before = (await listCategories()).map((cat) => cat.id);

    for (const orderedIds of [
      [def.id, a.id, b.id],
      [a.id, b.id, 'no-such-category'],
      [a.id],
      [a.id, a.id],
      [a.id, 7],
      'nope',
      undefined,
    ]) {
      await expectRefused('projects.categories.reorder', { orderedIds });
    }
    await expectRefused('projects.categories.reorder', {});
    expect((await listCategories()).map((cat) => cat.id)).toEqual(before);
  });
});

describe('projects.move (FR-055)', () => {
  it('returns { orderedIds }, and projects.list reflects the category and the order', async () => {
    const parked = await createCategory('Parked');
    const a = await createProject('A');
    const b = await createProject('B');
    const c = await createProject('C');

    const result = await ok<{ orderedIds: string[] }>('projects.move', {
      id: a.id,
      categoryId: parked.id,
      orderedIds: [b.id, c.id, a.id],
    });
    expect(result).toEqual({ orderedIds: [b.id, c.id, a.id] });

    const projects = await listProjects();
    expect(projects.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    expect(projects.find((p) => p.id === a.id)?.categoryId).toBe(parked.id);
  });

  it('refuses an unknown project, an unknown category, and orderedIds that is not an array of strings', async () => {
    const parked = await createCategory('Parked');
    const a = await createProject('A');
    const before = await listProjects();

    await expectRefused('projects.move', { id: 'no-such-project', categoryId: parked.id, orderedIds: [a.id] });
    await expectRefused('projects.move', { id: a.id, categoryId: 'no-such-category', orderedIds: [a.id] });
    await expectRefused('projects.move', { id: a.id, categoryId: parked.id, orderedIds: 'nope' });
    await expectRefused('projects.move', { id: a.id, categoryId: parked.id, orderedIds: [a.id, 7] });
    await expectRefused('projects.move', { id: a.id, categoryId: parked.id });

    expect(await listProjects()).toEqual(before);
  });
});

describe('projects.list categoryId (FR-059, R9 heal rule)', () => {
  it('puts a project created before any category call into the default category', async () => {
    // No categories.* call first: the default must exist by the time the project is listed.
    const a = await createProject('First');
    const projects = await listProjects();
    const def = await defaultCategory();
    expect(projects.find((p) => p.id === a.id)?.categoryId).toBe(def.id);
  });

  it('never reports \'\' — a healed or dangling category_id reads back as the default', async () => {
    const a = await createProject('A');
    const b = await createProject('B');
    const def = await defaultCategory();
    db.prepare(`UPDATE projects SET category_id = '' WHERE id = ?`).run(a.id);
    db.prepare(`UPDATE projects SET category_id = 'no-such-category' WHERE id = ?`).run(b.id);

    const projects = await listProjects();
    expect(projects.every((p) => typeof p.categoryId === 'string' && p.categoryId !== '')).toBe(true);
    expect(projects.find((p) => p.id === a.id)?.categoryId).toBe(def.id);
    expect(projects.find((p) => p.id === b.id)?.categoryId).toBe(def.id);
  });

  it('never reports \'\' even when the owner has no default category yet', async () => {
    // The shape a guard-healed store is in: projects whose category_id is '' and NO category row at
    // all, so there is no default for the read-time heal to resolve into. No categories.* call is
    // made first, because the renderer loads projects.list on its own.
    const a = await createProject('A');
    db.prepare(`UPDATE projects SET category_id = ''`).run();
    db.prepare(`DELETE FROM project_categories`).run();

    const projects = await listProjects();
    expect(projects.find((p) => p.id === a.id)?.categoryId).not.toBe('');
    expect(projects.find((p) => p.id === a.id)?.categoryId).toBe((await defaultCategory()).id);
  });
});
