import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProjectService,
  ProjectNotFoundError,
  ProjectValidationError,
  type IProjectStore,
  type IUserContext,
  type Project,
} from '@throng/core';

/** In-memory IProjectStore honouring owner scoping + single-active exclusivity. */
class FakeProjectStore implements IProjectStore {
  readonly rows = new Map<string, Project>();

  list(ownerUser: string): Project[] {
    return [...this.rows.values()].filter((p) => p.ownerUser === ownerUser);
  }
  getById(ownerUser: string, id: string): Project | undefined {
    const row = this.rows.get(id);
    return row && row.ownerUser === ownerUser ? row : undefined;
  }
  insert(project: Project): void {
    this.rows.set(project.id, { ...project });
  }
  update(project: Project): void {
    this.rows.set(project.id, { ...project });
  }
  remove(ownerUser: string, id: string): void {
    const row = this.rows.get(id);
    if (row && row.ownerUser === ownerUser) this.rows.delete(id);
  }
  setActiveExclusive(ownerUser: string, id: string): void {
    for (const row of this.rows.values()) {
      if (row.ownerUser === ownerUser) row.isActive = row.id === id;
    }
  }
  reorder(ownerUser: string, orderedIds: string[]): void {
    const owned = orderedIds
      .map((id) => this.rows.get(id))
      .filter((p): p is Project => !!p && p.ownerUser === ownerUser);
    const others = [...this.rows.entries()].filter(
      ([id, p]) => p.ownerUser !== ownerUser || !orderedIds.includes(id),
    );
    this.rows.clear();
    for (const p of owned) this.rows.set(p.id, p);
    for (const [id, p] of others) this.rows.set(id, p);
  }
}

const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let store: FakeProjectStore;
let service: ProjectService;
let idCounter: number;

beforeEach(() => {
  store = new FakeProjectStore();
  idCounter = 0;
  service = new ProjectService({
    store,
    userContext,
    newId: () => `p${++idCounter}`,
    now: () => '2026-06-26T00:00:00.000Z',
  });
});

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
