import { beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectNotFoundError,
  ProjectService,
  applyHtmlSafeSources,
  createProject,
  type IUserContext,
} from '@throng/core';
import { InMemoryProjectCategoryStore, InMemoryProjectStore } from './fixtures/project-stores.js';

/**
 * 074 T041 (FR-072a) — a project's own safe HTML preview sources, kept beside its hidden paths and
 * search exclusions and independent of both.
 */
const base = createProject(
  { name: 'Demo', colour: '#336699', rootFolder: 'D:/demo' },
  { id: 'p1', ownerUser: 'alice', now: '2026-10-29T00:00:00.000Z' },
);

describe('Project.htmlSafeSources', () => {
  it('starts empty on a new project', () => {
    expect(base.htmlSafeSources).toEqual([]);
  });

  it('is replaced whole — canonical https origins, de-duplicated, invalid dropped — bumping updatedAt only', () => {
    const next = applyHtmlSafeSources(
      base,
      ['https://Cdn.Example.com/path', 'https://cdn.example.com', 'http://insecure.example', '*.example.org', 'a b'],
      '2026-10-29T01:00:00.000Z',
    );
    expect(next.htmlSafeSources).toEqual(['https://cdn.example.com', 'https://*.example.org']);
    expect(next.updatedAt).toBe('2026-10-29T01:00:00.000Z');
    expect(next.searchExcludeGlobs).toBe(base.searchExcludeGlobs);
  });
});

describe('ProjectService.setHtmlSafeSources', () => {
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

  it('replaces the list and leaves the other lists alone', () => {
    const p = service.create({ name: 'Demo', colour: '#336699', rootFolder: 'D:/demo' });
    service.setHidden(p.id, ['src/gen']);
    const updated = service.setHtmlSafeSources(p.id, ['https://cdn.example.com']);
    expect(updated.htmlSafeSources).toEqual(['https://cdn.example.com']);
    expect(updated.hiddenPaths).toEqual(['src/gen']);
    expect(service.list().find((x) => x.id === p.id)?.htmlSafeSources).toEqual(['https://cdn.example.com']);
  });

  it('refuses a project that does not exist', () => {
    expect(() => service.setHtmlSafeSources('nope', [])).toThrow(ProjectNotFoundError);
  });
});
