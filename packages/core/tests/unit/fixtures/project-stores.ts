/**
 * In-memory fakes of the two project storage ports, shared by the core service tests.
 *
 * They honour the invariants the SQLite repositories do — owner scoping, a single active project,
 * a global project order, list order for categories and one default per owner — so a service test
 * that passes here is exercising the rules, not the fake. `deleteMerge` is one step, as the
 * repository's transaction is.
 */
import type { IProjectCategoryStore, IProjectStore, Project, ProjectCategory } from '@throng/core';

export class InMemoryProjectStore implements IProjectStore {
  /** Insertion order IS the global position order, as `projects.position` is in SQLite. */
  readonly rows = new Map<string, Project>();

  list(ownerUser: string): Project[] {
    return [...this.rows.values()].filter((p) => p.ownerUser === ownerUser).map((p) => ({ ...p }));
  }
  getById(ownerUser: string, id: string): Project | undefined {
    const row = this.rows.get(id);
    return row && row.ownerUser === ownerUser ? { ...row } : undefined;
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
  reorder(ownerUser: string, orderedIds: readonly string[]): void {
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
  move(ownerUser: string, id: string, categoryId: string, orderedIds: readonly string[]): void {
    const row = this.rows.get(id);
    if (row && row.ownerUser === ownerUser) row.categoryId = categoryId;
    this.reorder(ownerUser, orderedIds);
  }
}

export class InMemoryProjectCategoryStore implements IProjectCategoryStore {
  readonly rows = new Map<string, ProjectCategory>();
  /** Calls to `ensureDefault`, so a test can prove a service asked before it read. */
  ensureDefaultCalls = 0;

  constructor(private readonly projects: InMemoryProjectStore) {}

  ensureDefault(ownerUser: string, seed: { id: string; name: string; now: string }): ProjectCategory {
    this.ensureDefaultCalls += 1;
    const existing = [...this.rows.values()].find((c) => c.ownerUser === ownerUser && c.isDefault);
    if (existing) return { ...existing };
    const created: ProjectCategory = {
      id: seed.id,
      ownerUser,
      name: seed.name,
      isDefault: true,
      minimised: false,
      position: 0,
      createdAt: seed.now,
      updatedAt: seed.now,
    };
    this.rows.set(created.id, created);
    return { ...created };
  }
  /** The default first, then `position`, then `id` — the SQL store's order (FR-083 / FR-084). */
  list(ownerUser: string): ProjectCategory[] {
    return [...this.rows.values()]
      .filter((c) => c.ownerUser === ownerUser)
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          a.position - b.position ||
          a.id.localeCompare(b.id),
      )
      .map((c) => ({ ...c }));
  }
  /** Appends: one past the owner's highest non-default position, whatever was passed (FR-084). */
  create(category: ProjectCategory): void {
    const positions = [...this.rows.values()]
      .filter((c) => c.ownerUser === category.ownerUser && !c.isDefault)
      .map((c) => c.position);
    const position = positions.length === 0 ? 0 : Math.max(...positions) + 1;
    this.rows.set(category.id, { ...category, position });
  }
  reorder(ownerUser: string, orderedIds: readonly string[]): void {
    orderedIds.forEach((id, index) => {
      const row = this.owned(ownerUser, id);
      if (row && !row.isDefault) row.position = index;
    });
  }
  rename(ownerUser: string, id: string, name: string, now: string): void {
    const row = this.owned(ownerUser, id);
    if (row) Object.assign(row, { name, updatedAt: now });
  }
  setMinimised(ownerUser: string, id: string, minimised: boolean, now: string): void {
    const row = this.owned(ownerUser, id);
    if (row) Object.assign(row, { minimised, updatedAt: now });
  }
  deleteMerge(ownerUser: string, id: string, defaultId: string, orderedIds: readonly string[]): void {
    for (const project of this.projects.rows.values()) {
      if (project.ownerUser === ownerUser && project.categoryId === id) project.categoryId = defaultId;
    }
    this.projects.reorder(ownerUser, orderedIds);
    if (this.owned(ownerUser, id)) this.rows.delete(id);
  }

  private owned(ownerUser: string, id: string): ProjectCategory | undefined {
    const row = this.rows.get(id);
    return row && row.ownerUser === ownerUser ? row : undefined;
  }
}
