/**
 * 046 — ProjectCategoryService (contracts/project-categories.md §2 and §5; FR-050, FR-051, FR-053,
 * FR-054, FR-083, FR-084).
 *
 * The rules live here rather than in the repository, so the daemon's handlers and any later caller
 * are refused the same things: the UI drawing no delete control for the default category is a
 * courtesy, not the guard.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectCategoryError,
  ProjectCategoryService,
  ProjectValidationError,
  SHIPPED_DEFAULT_CATEGORY_NAME,
  type IUserContext,
  type Project,
} from '@throng/core';
import { InMemoryProjectCategoryStore, InMemoryProjectStore } from './fixtures/project-stores.js';

const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let projects: InMemoryProjectStore;
let store: InMemoryProjectCategoryStore;
let service: ProjectCategoryService;
let idCounter: number;
let clock: number;

beforeEach(() => {
  projects = new InMemoryProjectStore();
  store = new InMemoryProjectCategoryStore(projects);
  idCounter = 0;
  clock = 0;
  service = new ProjectCategoryService({
    store,
    projectStore: projects,
    userContext,
    newId: () => `c${++idCounter}`,
    // A strictly increasing clock, so "listed last" is decided by createdAt and not by luck.
    now: () => `2026-09-23T00:00:${String(++clock).padStart(2, '0')}.000Z`,
  });
});

function seedProject(id: string, categoryId: string): void {
  const project: Project = {
    id,
    ownerUser: 'alice',
    name: id,
    colour: '#6aa3ff',
    rootFolder: `C:/code/${id}`,
    isActive: false,
    hiddenPaths: [],
    categoryId,
    createdAt: 'now',
    updatedAt: 'now',
  };
  projects.insert(project);
}

/** Assert a call is refused with a given reason, and that the refusal is a validation error. */
function expectRefusal(fn: () => unknown, reason: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected a refusal with reason "${reason}"`).toBeInstanceOf(ProjectCategoryError);
  // A validation error, so the daemon router maps it to -32602 (contract §1) with no new mapping.
  expect(caught).toBeInstanceOf(ProjectValidationError);
  expect((caught as ProjectCategoryError).reason).toBe(reason);
}

describe('list and create ensure the default category first (FR-050)', () => {
  it('gives a fresh owner the shipped default, named from core', () => {
    expect(SHIPPED_DEFAULT_CATEGORY_NAME).toBe('In Progress');
    const categories = service.list();
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({
      name: SHIPPED_DEFAULT_CATEGORY_NAME,
      isDefault: true,
      minimised: false,
      ownerUser: 'alice',
    });
    expect(store.ensureDefaultCalls).toBeGreaterThan(0);
  });

  it('creates the default before the first user category, so the new one is never alone', () => {
    const created = service.create('Archive');
    expect(created).toMatchObject({ name: 'Archive', isDefault: false, minimised: false });
    expect(service.list().map((c) => c.name)).toEqual([SHIPPED_DEFAULT_CATEGORY_NAME, 'Archive']);
  });

  it('lists a new category last', () => {
    service.create('One');
    service.create('Two');
    expect(service.list().map((c) => c.name)).toEqual([SHIPPED_DEFAULT_CATEGORY_NAME, 'One', 'Two']);
  });

  it('stores the trimmed name', () => {
    expect(service.create('  Spaced  ').name).toBe('Spaced');
  });
});

describe('name rules (FR-053)', () => {
  it('create refuses an empty name', () => {
    expectRefusal(() => service.create('   '), 'empty');
  });

  it('create refuses a duplicate that differs only in case — including the default’s name', () => {
    service.create('Archive');
    expectRefusal(() => service.create('ARCHIVE'), 'duplicate');
    expectRefusal(() => service.create('in progress'), 'duplicate');
  });

  it('rename refuses an empty name and a duplicate', () => {
    const a = service.create('Archive');
    service.create('Clients');
    expectRefusal(() => service.rename(a.id, ''), 'empty');
    expectRefusal(() => service.rename(a.id, 'clients'), 'duplicate');
  });

  /** Hardening (branch review) — same cap as a project's name (`project.ts` `MAX_NAME_LENGTH`). */
  it('create and rename refuse a name over 120 characters', () => {
    const over = 'x'.repeat(121);
    expectRefusal(() => service.create(over), 'tooLong');
    const a = service.create('Archive');
    expectRefusal(() => service.rename(a.id, over), 'tooLong');
  });

  it('rename accepts a re-casing of the category’s own name, and renames the default too', () => {
    const a = service.create('Archive');
    expect(service.rename(a.id, 'ARCHIVE').name).toBe('ARCHIVE');
    const def = service.list()[0]!;
    expect(service.rename(def.id, '  Current  ')).toMatchObject({ name: 'Current', isDefault: true });
    expect(service.list()[0]?.name).toBe('Current');
  });
});

describe('unknown ids are refused', () => {
  it('by rename, delete and setMinimised', () => {
    service.list();
    expectRefusal(() => service.rename('nope', 'X'), 'unknown');
    expectRefusal(() => service.delete('nope'), 'unknown');
    expectRefusal(() => service.setMinimised('nope', true), 'unknown');
  });

  it('never puts the raw id in the message the user reads', () => {
    // The renderer shows the message beside a subject naming the category (projects-store fail()),
    // so an internal UUID in it is noise at best. The message says what is wrong, not which id.
    service.list();
    const id = '3f2a9b1c-6d4e-4f00-9a1b-2c3d4e5f6a7b';
    for (const act of [
      () => service.rename(id, 'X'),
      () => service.delete(id),
      () => service.setMinimised(id, true),
    ]) {
      let caught: unknown;
      try {
        act();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ProjectCategoryError);
      expect((caught as Error).message).not.toContain(id);
      expect((caught as Error).message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the default category cannot be deleted or minimised (FR-050, US5 scenario 4)', () => {
  it('delete refuses it', () => {
    const def = service.list()[0]!;
    expectRefusal(() => service.delete(def.id), 'isDefault');
    expect(service.list()).toHaveLength(1);
  });

  it('setMinimised refuses it, in either direction', () => {
    const def = service.list()[0]!;
    expectRefusal(() => service.setMinimised(def.id, true), 'isDefault');
    expectRefusal(() => service.setMinimised(def.id, false), 'isDefault');
  });

  it('setMinimised sets the flag on any other category', () => {
    const a = service.create('Archive');
    expect(service.setMinimised(a.id, true).minimised).toBe(true);
    expect(service.list()[1]?.minimised).toBe(true);
    expect(service.setMinimised(a.id, false).minimised).toBe(false);
  });
});

describe('delete merges into the default category (FR-054)', () => {
  it('moves the members after the default’s, in their relative order, then removes the row', () => {
    const def = service.list()[0]!;
    const gone = service.create('Gone');
    const other = service.create('Other');
    // Global order interleaves everything.
    seedProject('x1', gone.id);
    seedProject('d1', def.id);
    seedProject('o1', other.id);
    seedProject('x2', gone.id);
    seedProject('d2', def.id);

    const result = service.delete(gone.id);

    expect(result.movedProjectIds).toEqual(['x1', 'x2']);
    expect(service.list().map((c) => c.id)).toEqual([def.id, other.id]);
    const after = projects.list('alice');
    expect(after.filter((p) => p.categoryId === def.id).map((p) => p.id)).toEqual(['d1', 'd2', 'x1', 'x2']);
    expect(after.filter((p) => p.categoryId === other.id).map((p) => p.id)).toEqual(['o1']);
  });

  it('reports no moved projects for an empty category', () => {
    const gone = service.create('Gone');
    expect(service.delete(gone.id)).toEqual({ movedProjectIds: [] });
  });
});

/**
 * 046 iterate round 1 — `reorder(orderedIds)` (FR-083, FR-084; contracts/project-categories.md §5).
 *
 * Pinned here: `reorder(orderedIds: string[]): ProjectCategory[]` — the owner's categories in their
 * new list order, which the daemon returns as `{ categories }`. `orderedIds` names every
 * NON-default category exactly once. Every refusal is a {@link ProjectValidationError}, so the
 * router reports it as invalid params (-32602) with no new mapping, and a refusal writes nothing.
 * A non-string array is refused by the shared `assertOrderedIds`; the per-id checks (the default's
 * id → `isDefault`, an id the owner does not have → `unknown`) come before the completeness check
 * (missing or duplicated), so those two carry their existing reasons. The completeness refusal's
 * reason is left to the implementer.
 */
describe('reorder sets the order of the non-default categories (FR-083, FR-084)', () => {
  let def: string;
  let a: string;
  let b: string;
  let c: string;

  beforeEach(() => {
    def = service.list()[0]!.id;
    a = service.create('Archive').id;
    b = service.create('Backlog').id;
    c = service.create('Clients').id;
  });

  function listedIds(): string[] {
    return service.list().map((cat) => cat.id);
  }

  /** Assert `orderedIds` is refused as invalid params and the order is untouched. */
  function expectRefusedAndUnchanged(orderedIds: unknown, reason?: string): void {
    const before = listedIds();
    let caught: unknown;
    try {
      service.reorder(orderedIds as string[]);
    } catch (error) {
      caught = error;
    }
    expect(caught, `expected ${JSON.stringify(orderedIds)} to be refused`).toBeInstanceOf(
      ProjectValidationError,
    );
    if (reason !== undefined) {
      expect(caught).toBeInstanceOf(ProjectCategoryError);
      expect((caught as ProjectCategoryError).reason).toBe(reason);
    }
    expect((caught as Error).message.trim().length).toBeGreaterThan(0);
    expect(listedIds()).toEqual(before);
  }

  it('reorders, keeps the default first, and returns the new list', () => {
    const result = service.reorder([c, a, b]);
    expect(result.map((cat) => cat.id)).toEqual([def, c, a, b]);
    expect(listedIds()).toEqual([def, c, a, b]);
  });

  it('a category keeps its minimised state and name when it moves', () => {
    service.setMinimised(a, true);
    service.reorder([b, c, a]);
    const moved = service.list().find((cat) => cat.id === a);
    expect(moved).toMatchObject({ name: 'Archive', minimised: true });
  });

  it('a category created after a reorder is listed last (FR-084)', () => {
    service.reorder([c, b, a]);
    const d = service.create('Drafts').id;
    expect(listedIds()).toEqual([def, c, b, a, d]);
  });

  it('refuses the default category\'s id, wherever it is placed (FR-083)', () => {
    expectRefusedAndUnchanged([def, a, b, c], 'isDefault');
    expectRefusedAndUnchanged([a, b, c, def], 'isDefault');
  });

  it('refuses an unknown id, without putting it in the message', () => {
    const unknown = '3f2a9b1c-6d4e-4f00-9a1b-2c3d4e5f6a7b';
    expectRefusedAndUnchanged([a, b, c, unknown], 'unknown');
    expectRefusedAndUnchanged([a, b, unknown]);
    try {
      service.reorder([a, b, unknown]);
    } catch (error) {
      expect((error as Error).message).not.toContain(unknown);
    }
  });

  it('refuses a list that leaves a category out', () => {
    expectRefusedAndUnchanged([c, a]);
    expectRefusedAndUnchanged([]);
  });

  it('refuses a list that names a category twice', () => {
    expectRefusedAndUnchanged([a, b, c, a]);
    // The same length as a valid list, so a length check alone cannot pass it.
    expectRefusedAndUnchanged([a, a, c]);
  });

  it('refuses anything that is not an array of strings (the projects.reorder check)', () => {
    for (const bad of ['nope', null, undefined, 42, { 0: a }, [a, b, 3], [a, null, c]]) {
      expectRefusedAndUnchanged(bad);
    }
  });

  it('refuses another owner\'s category as unknown', () => {
    // A store row under another owner, invisible to Alice's list.
    store.create({
      id: 'bob-cat',
      ownerUser: 'bob',
      name: 'Bob',
      isDefault: false,
      minimised: false,
      position: 0,
      createdAt: 'now',
      updatedAt: 'now',
    });
    expectRefusedAndUnchanged([a, b, c, 'bob-cat'], 'unknown');
    expectRefusedAndUnchanged([a, 'bob-cat', c], 'unknown');
  });
});
