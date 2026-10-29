import { beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectNotFoundError,
  ProjectService,
  applySearchExcludeGlobs,
  createProject,
  type IUserContext,
} from '@throng/core';
import { InMemoryProjectCategoryStore, InMemoryProjectStore } from './fixtures/project-stores.js';

/**
 * 060 #532 T043 (FR-030, FR-040, research R21) — a project's own Find in Files exclusions, kept beside
 * its hidden paths and independent of them.
 */
const base = createProject(
  { name: 'Demo', colour: '#336699', rootFolder: 'D:/demo' },
  { id: 'p1', ownerUser: 'alice', now: '2026-10-29T00:00:00.000Z' },
);

describe('Project.searchExcludeGlobs', () => {
  it('starts empty on a new project', () => {
    expect(base.searchExcludeGlobs).toEqual([]);
  });

  it('is replaced whole — trimmed, de-duplicated, empties dropped — bumping updatedAt and nothing else', () => {
    const next = applySearchExcludeGlobs(base, [' **/gen ', '**/gen', '', '**/fixtures'], '2026-10-29T01:00:00.000Z');
    expect(next.searchExcludeGlobs).toEqual(['**/gen', '**/fixtures']);
    expect(next.updatedAt).toBe('2026-10-29T01:00:00.000Z');
    expect(next.hiddenPaths).toBe(base.hiddenPaths);
  });
});

describe('ProjectService.setSearchExcludes', () => {
  const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };
  let service: ProjectService;

  beforeEach(() => {
    const store = new InMemoryProjectStore();
    let n = 0;
    service = new ProjectService({
      store,
      categories: new InMemoryProjectCategoryStore(store),
      userContext,
      newId: () => `p${++n}`,
      now: () => '2026-10-29T00:00:00.000Z',
    });
  });

  it('replaces the list and leaves the hidden paths alone', () => {
    const p = service.create({ name: 'Demo', colour: '#336699', rootFolder: 'D:/demo' });
    service.setHidden(p.id, ['src/gen']);
    const updated = service.setSearchExcludes(p.id, ['**/fixtures']);
    expect(updated.searchExcludeGlobs).toEqual(['**/fixtures']);
    expect(updated.hiddenPaths).toEqual(['src/gen']);
    expect(service.list().find((x) => x.id === p.id)?.searchExcludeGlobs).toEqual(['**/fixtures']);
  });

  it('refuses a project that does not exist', () => {
    expect(() => service.setSearchExcludes('nope', [])).toThrow(ProjectNotFoundError);
  });
});
