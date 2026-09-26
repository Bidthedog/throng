import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProjectCategoryError,
  ProjectService,
  ProjectNotFoundError,
  ProjectValidationError,
  SHIPPED_DEFAULT_CATEGORY_NAME,
  type IUserContext,
} from '@throng/core';
import { InMemoryProjectCategoryStore, InMemoryProjectStore } from './fixtures/project-stores.js';

const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let store: InMemoryProjectStore;
let categories: InMemoryProjectCategoryStore;
let service: ProjectService;
let idCounter: number;

beforeEach(() => {
  store = new InMemoryProjectStore();
  categories = new InMemoryProjectCategoryStore(store);
  idCounter = 0;
  service = new ProjectService({
    store,
    categories,
    userContext,
    newId: () => `p${++idCounter}`,
    now: () => '2026-06-26T00:00:00.000Z',
  });
});

/** Add a non-default category for alice directly, as the category service would. */
function addCategory(id: string): void {
  categories.create({
    id,
    ownerUser: 'alice',
    name: id,
    isDefault: false,
    minimised: false,
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
  });
}

const input = (name: string) => ({ name, colour: '#6aa3ff', rootFolder: `C:/code/${name}` });

describe('ProjectService.create', () => {
  it('persists the project scoped to the current owner', () => {
    const project = service.create(input('alpha'));
    expect(project.ownerUser).toBe('alice');
    expect(store.getById('alice', project.id)).toBeDefined();
  });

  it('makes the first project active, later ones inactive', () => {
    const first = service.create(input('alpha'));
    const second = service.create(input('beta'));
    expect(store.getById('alice', first.id)?.isActive).toBe(true);
    expect(store.getById('alice', second.id)?.isActive).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(() => service.create({ name: '', colour: '#fff', rootFolder: 'C:/x' })).toThrow(
      ProjectValidationError,
    );
  });

  it('assigns the owner’s default category, creating it on a fresh database (FR-059)', () => {
    const project = service.create(input('alpha'));
    const def = categories.list('alice').find((c) => c.isDefault);
    expect(def?.name).toBe(SHIPPED_DEFAULT_CATEGORY_NAME);
    expect(project.categoryId).toBe(def?.id);
    expect(store.getById('alice', project.id)?.categoryId).toBe(def?.id);
  });

  it('lands in the default category even when other categories exist', () => {
    service.create(input('alpha'));
    addCategory('work');
    const beta = service.create(input('beta'));
    expect(beta.categoryId).toBe(categories.list('alice').find((c) => c.isDefault)?.id);
  });
});

describe('ProjectService.move (FR-055)', () => {
  it('sets the category and rewrites the global order in one call', () => {
    const a = service.create(input('alpha'));
    const b = service.create(input('beta'));
    const c = service.create(input('gamma'));
    addCategory('work');

    const result = service.move(a.id, 'work', [b.id, c.id, a.id]);

    expect(result).toEqual({ orderedIds: [b.id, c.id, a.id] });
    expect(store.getById('alice', a.id)?.categoryId).toBe('work');
    expect(service.list().map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    // The others stay where they were.
    expect(store.getById('alice', b.id)?.categoryId).not.toBe('work');
  });

  it('moves back into the default category', () => {
    const a = service.create(input('alpha'));
    const def = a.categoryId;
    addCategory('work');
    service.move(a.id, 'work', [a.id]);
    service.move(a.id, def, [a.id]);
    expect(store.getById('alice', a.id)?.categoryId).toBe(def);
  });

  it('refuses an unknown project as invalid params, changing nothing (contract §1)', () => {
    const a = service.create(input('alpha'));
    addCategory('work');
    expect(() => service.move('nope', 'work', [a.id])).toThrow(ProjectValidationError);
    expect(store.getById('alice', a.id)?.categoryId).not.toBe('work');
  });

  it('refuses an unknown category, changing nothing (contract §1)', () => {
    const a = service.create(input('alpha'));
    const before = a.categoryId;
    expect(() => service.move(a.id, 'nowhere', [a.id])).toThrow(ProjectCategoryError);
    expect(store.getById('alice', a.id)?.categoryId).toBe(before);
  });

  it('never puts a raw id in the refusal message the user reads', () => {
    // projects-store's fail() shows the message beside a subject that already names the project, so
    // the message says what is wrong, not which UUID.
    const a = service.create(input('alpha'));
    addCategory('work');
    const ghostProject = '9d8c7b6a-0000-4000-8000-000000000001';
    const ghostCategory = '9d8c7b6a-0000-4000-8000-000000000002';
    for (const [act, id] of [
      [() => service.move(ghostProject, 'work', [a.id]), ghostProject],
      [() => service.move(a.id, ghostCategory, [a.id]), ghostCategory],
    ] as const) {
      let caught: unknown;
      try {
        act();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ProjectValidationError);
      expect((caught as Error).message).not.toContain(id);
    }
  });

  it('reports a missing category store as a wiring fault, not as an unknown category', () => {
    const unwired = new ProjectService({
      store,
      userContext,
      newId: () => `q${++idCounter}`,
      now: () => '2026-06-26T00:00:00.000Z',
    });
    const a = unwired.create(input('alpha'));
    let caught: unknown;
    try {
      unwired.move(a.id, 'work', [a.id]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ProjectValidationError);
    expect((caught as Error).message).toMatch(/category store/);
  });

  it('applies the orderedIds validation reorder applies — an array of strings', () => {
    const a = service.create(input('alpha'));
    addCategory('work');
    // Untyped callers (the RPC boundary) can hand anything over; both methods refuse the same shapes.
    for (const bad of [undefined, 'a', [1, 2], [a.id, null]] as unknown[]) {
      expect(() => service.move(a.id, 'work', bad as string[]), JSON.stringify(bad)).toThrow(
        ProjectValidationError,
      );
      expect(() => service.reorder(bad as string[]), JSON.stringify(bad)).toThrow(ProjectValidationError);
    }
    expect(store.getById('alice', a.id)?.categoryId).not.toBe('work');
  });
});

describe('ProjectService.list', () => {
  it('returns only the current owner’s projects', () => {
    service.create(input('alpha'));
    store.insert({
      id: 'other',
      ownerUser: 'bob',
      name: 'bobs',
      colour: '#fff',
      rootFolder: 'C:/b',
      isActive: true,
      createdAt: 'now',
      updatedAt: 'now',
    });
    const list = service.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.ownerUser).toBe('alice');
  });
});

describe('ProjectService.update', () => {
  it('edits name/colour and persists', () => {
    const project = service.create(input('alpha'));
    const updated = service.update(project.id, { name: 'Alpha Prime', colour: '#ff0000' });
    expect(updated.name).toBe('Alpha Prime');
    expect(updated.colour).toBe('#ff0000');
    expect(store.getById('alice', project.id)?.name).toBe('Alpha Prime');
  });

  it('throws ProjectNotFoundError for an unknown id', () => {
    expect(() => service.update('nope', { name: 'x' })).toThrow(ProjectNotFoundError);
  });
});

describe('ProjectService.setActive', () => {
  it('makes exactly one project active per owner', () => {
    const a = service.create(input('alpha'));
    const b = service.create(input('beta'));
    service.setActive(b.id);
    const active = service.list().filter((p) => p.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(b.id);
    expect(store.getById('alice', a.id)?.isActive).toBe(false);
  });

  it('throws for an unknown id', () => {
    expect(() => service.setActive('nope')).toThrow(ProjectNotFoundError);
  });
});

describe('ProjectService.reorder', () => {
  it('sets the owner-scoped project order', () => {
    const a = service.create(input('alpha'));
    const b = service.create(input('beta'));
    const c = service.create(input('gamma'));
    service.reorder([c.id, a.id, b.id]);
    expect(service.list().map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe('ProjectService.delete', () => {
  it('removes the project and reports it', () => {
    const a = service.create(input('alpha'));
    const result = service.delete(a.id);
    expect(result.deletedId).toBe(a.id);
    expect(store.getById('alice', a.id)).toBeUndefined();
  });

  it('when the active project is deleted, selects another and returns it', () => {
    const a = service.create(input('alpha')); // active
    const b = service.create(input('beta'));
    const result = service.delete(a.id);
    expect(result.newActiveId).toBe(b.id);
    expect(store.getById('alice', b.id)?.isActive).toBe(true);
  });

  it('when the last project is deleted, reports no new active', () => {
    const a = service.create(input('alpha'));
    const result = service.delete(a.id);
    expect(result.newActiveId).toBeNull();
  });

  it('deleting an inactive project leaves the active one unchanged', () => {
    const a = service.create(input('alpha')); // active
    const b = service.create(input('beta'));
    const result = service.delete(b.id);
    expect(result.newActiveId).toBeNull();
    expect(store.getById('alice', a.id)?.isActive).toBe(true);
  });

  it('throws for an unknown id', () => {
    expect(() => service.delete('nope')).toThrow(ProjectNotFoundError);
  });
});
