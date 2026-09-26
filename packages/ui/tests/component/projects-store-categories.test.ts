/**
 * The projects store's category slice (046 T011; contracts/project-categories.md §1, §4;
 * data-model.md §1, §7).
 *
 * `ProjectsProvider` gains a `categories` field beside `projects`, and five actions —
 * `createCategory`, `renameCategory`, `deleteCategory`, `setCategoryMinimised`, `moveProject` — each
 * of which must (a) call its RPC with the right params, (b) call `window.throng.projects.notifyChanged`
 * AFTER that RPC resolves, so other windows refresh (§1 "Refresh"), and (c) on a refusal, surface it
 * through the store's existing `fail(message, action, subject)` path with a subject that NAMES the
 * category — never a raw RPC string standing in for a subject (§1 "Failures", 030).
 *
 * Mounted the way `subworkspace-sync.test.ts` / `projects-panel-form.test.ts` mount the real store:
 * `ProjectsProvider` takes a `ProjectsClient` over a fake `ThrongBridge` that enforces the real
 * contract shapes, so a refusal here is the shape the daemon will actually send, not a string
 * invented to match a regex. This file exercises the STORE only (`renderHook` over `useProjects()`),
 * not `ProjectsPanel` — the panel's category UI does not exist yet (later tasks), and nothing here
 * needs it to.
 *
 * ══ WHAT THIS RED TEST COMMITS TO, BEYOND THE CONTRACT ══
 *
 * `contracts/project-categories.md` fixes the RPC shapes but not the STORE action's own signature.
 * Following the existing store's convention — `setProjectHidden(id, hiddenPaths)` takes positional
 * arguments rather than one options object — the five actions below are asserted as:
 *
 *   createCategory(name)
 *   renameCategory(id, name)
 *   deleteCategory(id)
 *   setCategoryMinimised(id, minimised)
 *   moveProject(id, categoryId, orderedIds)
 *
 * None of this exists yet (`categories`, the five actions): every test below fails today because the
 * destructured member is `undefined`, which is the RED this file is for. T021 is the GREEN task.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * Fixtures — local shapes, not `@throng/ipc-contract`'s: `ProjectCategoryDto` and the widened
 * `ProjectDto.categoryId` are T018's, not landed yet, and this file's fake daemon needs no more than
 * the fields the contract names.
 * ────────────────────────────────────────────────────────────────────────── */

interface CategoryFixture {
  id: string;
  name: string;
  isDefault: boolean;
  minimised: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProjectFixture {
  id: string;
  name: string;
  colour: string;
  rootFolder: string;
  categoryId: string;
}

const category = (id: string, name: string, isDefault = false, minimised = false): CategoryFixture => ({
  id,
  name,
  isDefault,
  minimised,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const project = (id: string, name: string, categoryId: string): ProjectFixture => ({
  id,
  name,
  colour: '#336699',
  rootFolder: `C:/code/${id}`,
  categoryId,
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A fake daemon at the BRIDGE, enforcing the shapes `project-categories.md` §1 and §2 describe.
 * ────────────────────────────────────────────────────────────────────────── */

function fakeDaemon(
  seedCategories: CategoryFixture[],
  seedProjects: ProjectFixture[] = [],
  opts: { categoriesError?: Error } = {},
) {
  /** Mutable, so a test can make the daemon RECOVER mid-flight without a second mount. */
  const categoriesErrorRef: { current: Error | undefined } = { current: opts.categoriesError };
  let categories = seedCategories.map((c) => ({ ...c }));
  let projects = seedProjects.map((p) => ({ ...p }));
  /** `rpc:<method>` for every call, and `notify` pushed by the window stub below — ONE shared log, so
   *  a test can prove notifyChanged happened AFTER the mutating RPC, not merely that both happened. */
  const events: string[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];

  const findCategory = (id: string) => categories.find((c) => c.id === id);
  const defaultCategory = (): CategoryFixture => {
    const found = categories.find((c) => c.isDefault);
    if (!found) throw new Error('fixture error: no default category seeded');
    return found;
  };

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      events.push(`rpc:${method}`);
      calls.push({ method, params });
      switch (method) {
        case 'projects.list':
          return Promise.resolve({
            projects: projects.map((p) => ({
              ...p,
              isActive: false,
              hiddenPaths: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            })),
          } as TResult);

        case 'projects.categories.list':
          if (categoriesErrorRef.current) return Promise.reject(categoriesErrorRef.current);
          return Promise.resolve({ categories: [...categories] } as TResult);

        case 'projects.categories.create': {
          const { name } = params as { name: string };
          const trimmed = name.trim();
          if (!trimmed) return Promise.reject(new Error('a category name cannot be empty'));
          if (
            categories.some((c) => c.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())
          ) {
            return Promise.reject(new Error('a category with that name already exists'));
          }
          const created = category(`cat-${categories.length + 1}`, trimmed);
          categories = [...categories, created];
          return Promise.resolve({ category: created } as TResult);
        }

        case 'projects.categories.rename': {
          const { id, name } = params as { id: string; name: string };
          const existing = findCategory(id);
          if (!existing) return Promise.reject(new Error(`no such category: ${id}`));
          const trimmed = name.trim();
          if (!trimmed) return Promise.reject(new Error('a category name cannot be empty'));
          if (
            categories.some(
              (c) => c.id !== id && c.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
            )
          ) {
            return Promise.reject(new Error('a category with that name already exists'));
          }
          const renamed = { ...existing, name: trimmed };
          categories = categories.map((c) => (c.id === id ? renamed : c));
          return Promise.resolve({ category: renamed } as TResult);
        }

        case 'projects.categories.delete': {
          const { id } = params as { id: string };
          const existing = findCategory(id);
          if (!existing) return Promise.reject(new Error(`no such category: ${id}`));
          if (existing.isDefault) {
            return Promise.reject(new Error('the default category cannot be deleted'));
          }
          const target = defaultCategory();
          const movedProjectIds = projects.filter((p) => p.categoryId === id).map((p) => p.id);
          projects = projects.map((p) => (p.categoryId === id ? { ...p, categoryId: target.id } : p));
          categories = categories.filter((c) => c.id !== id);
          return Promise.resolve({ movedProjectIds } as TResult);
        }

        case 'projects.categories.setMinimised': {
          const { id, minimised } = params as { id: string; minimised: boolean };
          const existing = findCategory(id);
          if (!existing) return Promise.reject(new Error(`no such category: ${id}`));
          if (existing.isDefault) {
            return Promise.reject(new Error('the default category cannot be minimised'));
          }
          const next = { ...existing, minimised };
          categories = categories.map((c) => (c.id === id ? next : c));
          return Promise.resolve({ category: next } as TResult);
        }

        case 'projects.move': {
          const { id, categoryId, orderedIds } = params as {
            id: string;
            categoryId: string;
            orderedIds: string[];
          };
          if (!projects.some((p) => p.id === id)) {
            return Promise.reject(new Error(`no such project: ${id}`));
          }
          if (!findCategory(categoryId)) {
            return Promise.reject(new Error(`no such category: ${categoryId}`));
          }
          projects = projects.map((p) => (p.id === id ? { ...p, categoryId } : p));
          return Promise.resolve({ orderedIds } as TResult);
        }

        default:
          return Promise.reject(new Error(`unexpected RPC from the categories store test: ${method}`));
      }
    },
  };

  return { bridge, events, calls, categoriesErrorRef };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

function stubWindowThrong(events: string[]): void {
  Reflect.set(window, 'throng', {
    projects: {
      onChanged: () => () => {},
      notifyChanged: () => {
        events.push('notify');
      },
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

function wrapperFor(client: ProjectsClient) {
  return function Wrapper({ children }: { children?: ReactNode }): ReactElement {
    return createElement(ProjectsProvider, { client, children });
  };
}

async function mount(
  seedCategories: CategoryFixture[],
  seedProjects: ProjectFixture[] = [],
  opts: { categoriesError?: Error } = {},
) {
  const daemon = fakeDaemon(seedCategories, seedProjects, opts);
  stubWindowThrong(daemon.events);
  const client = new ProjectsClient(daemon.bridge);
  const { result } = renderHook(() => useProjects(), { wrapper: wrapperFor(client) });

  await waitFor(() => expect(result.current.loading).toBe(false));
  return { result, daemon };
}

/** Index of the LAST `rpc:<method>` entry in the shared event log, or -1. */
function lastIndexOfRpc(events: string[], method: string): number {
  return events.lastIndexOf(`rpc:${method}`);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * categories loads beside projects
 * ────────────────────────────────────────────────────────────────────────── */

describe('categories loads beside projects', () => {
  it('is populated from projects.categories.list once loading settles', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const archived = category('cat-2', 'Archived');
    const { result } = await mount([defaultCat, archived]);

    expect(result.current.categories).toEqual([defaultCat, archived]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A genuine categories load failure surfaces a notice — never swallowed (fix round on 5eb0d3e3 /
 * 4c324688 / 0ca7c91c). Projects must still list: `projects.categories.list` failing is not
 * `projects.list` failing, and a user with a broken categories fetch still needs to see, open and
 * switch between their projects.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a genuine projects.categories.list failure surfaces a notice, and never swallows silently', () => {
  it('keeps the project list, and reports the failure through fail() rather than losing it', async () => {
    const p1 = project('p1', 'One', 'cat-default');
    const { result, daemon } = await mount([], [p1], {
      categoriesError: new Error('the daemon refused projects.categories.list'),
    });

    // The RPC really was attempted — no false positive from an unreachable assertion below.
    expect(daemon.events).toContain('rpc:projects.categories.list');

    // Projects still list. A categories failure must not take the project list down with it.
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0]?.id).toBe('p1');

    // The failure is REPORTED, not swallowed: `error`/`errorAction` are the same `fail()` path
    // every other refusal in this store goes through, not a value invented for this one case.
    expect(result.current.error).not.toBeNull();
    expect(result.current.errorAction).toBe('load your project categories');
    expect(typeof result.current.error).toBe('string');

    // categories stays at its last known value (empty: nothing ever loaded) rather than throwing
    // or leaving the field `undefined`.
    expect(result.current.categories).toEqual([]);
  });

  it('clears once refresh() actually answers, having failed the first time', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const p1 = project('p1', 'One', 'cat-default');
    const failing = new Error('the daemon refused projects.categories.list');
    const { result, daemon } = await mount([defaultCat], [p1], { categoriesError: failing });
    expect(result.current.error).not.toBeNull();

    daemon.categoriesErrorRef.current = undefined; // the daemon recovers
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.errorAction).toBeNull();
    expect(result.current.categories).toEqual([defaultCat]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Each action calls its RPC, then notifyChanged (§1 "Refresh")
 * ────────────────────────────────────────────────────────────────────────── */

describe('each category action calls its RPC, then projects.notifyChanged', () => {
  it('createCategory({name}) — projects.categories.create, then notify', async () => {
    const { result, daemon } = await mount([category('cat-default', 'In Progress', true)]);

    await act(async () => {
      await result.current.createCategory('Archived');
    });

    const rpcIndex = lastIndexOfRpc(daemon.events, 'projects.categories.create');
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(daemon.calls[rpcIndex]?.params).toEqual({ name: 'Archived' });
    expect(daemon.events.indexOf('notify')).toBeGreaterThan(rpcIndex);
  });

  it('renameCategory(id, name) — projects.categories.rename, then notify', async () => {
    const target = category('cat-2', 'Archived');
    const { result, daemon } = await mount([category('cat-default', 'In Progress', true), target]);

    await act(async () => {
      await result.current.renameCategory('cat-2', 'Done');
    });

    const rpcIndex = lastIndexOfRpc(daemon.events, 'projects.categories.rename');
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(daemon.calls[rpcIndex]?.params).toEqual({ id: 'cat-2', name: 'Done' });
    expect(daemon.events.indexOf('notify')).toBeGreaterThan(rpcIndex);
  });

  it('deleteCategory(id) — projects.categories.delete, then notify', async () => {
    const target = category('cat-2', 'Archived');
    const { result, daemon } = await mount([category('cat-default', 'In Progress', true), target]);

    await act(async () => {
      await result.current.deleteCategory('cat-2');
    });

    const rpcIndex = lastIndexOfRpc(daemon.events, 'projects.categories.delete');
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(daemon.calls[rpcIndex]?.params).toEqual({ id: 'cat-2' });
    expect(daemon.events.indexOf('notify')).toBeGreaterThan(rpcIndex);
  });

  it('setCategoryMinimised(id, minimised) — projects.categories.setMinimised, then notify', async () => {
    const target = category('cat-2', 'Archived');
    const { result, daemon } = await mount([category('cat-default', 'In Progress', true), target]);

    await act(async () => {
      await result.current.setCategoryMinimised('cat-2', true);
    });

    const rpcIndex = lastIndexOfRpc(daemon.events, 'projects.categories.setMinimised');
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(daemon.calls[rpcIndex]?.params).toEqual({ id: 'cat-2', minimised: true });
    expect(daemon.events.indexOf('notify')).toBeGreaterThan(rpcIndex);
  });

  it('moveProject(id, categoryId, orderedIds) — projects.move, then notify', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const target = category('cat-2', 'Archived');
    const p1 = project('p1', 'One', 'cat-default');
    const { result, daemon } = await mount([defaultCat, target], [p1]);

    await act(async () => {
      await result.current.moveProject('p1', 'cat-2', ['p1']);
    });

    const rpcIndex = lastIndexOfRpc(daemon.events, 'projects.move');
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(daemon.calls[rpcIndex]?.params).toEqual({
      id: 'p1',
      categoryId: 'cat-2',
      orderedIds: ['p1'],
    });
    expect(daemon.events.indexOf('notify')).toBeGreaterThan(rpcIndex);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A refusal surfaces through fail(message, action, subject) — never a raw RPC string as the subject
 * ────────────────────────────────────────────────────────────────────────── */

describe('a category refusal names the CATEGORY as the subject, never a raw RPC string (030)', () => {
  it('deleting the default category is refused, and the notice is ABOUT that category', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const { result, daemon } = await mount([defaultCat]);

    await act(async () => {
      await result.current.deleteCategory('cat-default');
    });

    // The refusal really happened — no false positive from an unreachable assertion below.
    expect(daemon.events).toContain('rpc:projects.categories.delete');
    expect(result.current.error).not.toBeNull();
    expect(typeof result.current.error).toBe('string');

    // The SUBJECT names the category by its real name — not the RPC's error text repurposed as one,
    // and not `{ kind: 'none' }`, which is what a bare-string failure degrades to today.
    expect(result.current.errorSubject).toEqual({ kind: 'category', name: 'In Progress' });
    expect((result.current.errorSubject as { name?: string } | null)?.name).not.toBe(
      result.current.error,
    );

    // notifyChanged is a SUCCESS path (§1 "Refresh") — a refused mutation must not sync other windows
    // into believing something changed.
    expect(daemon.events).not.toContain('notify');

    // The category was not actually deleted — a refusal changes nothing.
    expect(result.current.categories).toEqual([defaultCat]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A mutation refusal survives an unrelated, successful refresh() — never silently cleared (fix
 * round on a7ad4767; 030 "one condition, one notice"). `refresh()` also runs from the CROSS-WINDOW
 * `onChanged` listener, so a plain, successful load triggered by someone ELSE'S edit in another
 * window must not erase a notice THIS window has not read yet.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a mutation refusal is not cleared by an unrelated successful refresh() (030)', () => {
  it('deleting the default category is refused, then refresh() (the onChanged path) leaves it', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const { result } = await mount([defaultCat]);

    await act(async () => {
      await result.current.deleteCategory('cat-default');
    });
    expect(result.current.error).not.toBeNull();
    const heldError = result.current.error;
    const heldAction = result.current.errorAction;
    const heldSubject = result.current.errorSubject;

    // The exact call the mount effect and the cross-window `onChanged` listener both make: a plain
    // load, about nothing this refusal was about, and one that SUCCEEDS.
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe(heldError);
    expect(result.current.errorAction).toBe(heldAction);
    expect(result.current.errorSubject).toEqual(heldSubject);
  });

  it('still clears a LOAD failure refresh() raised itself, once the load succeeds', async () => {
    const defaultCat = category('cat-default', 'In Progress', true);
    const failing = new Error('the daemon refused projects.categories.list');
    const { result, daemon } = await mount([defaultCat], [], { categoriesError: failing });
    expect(result.current.error).not.toBeNull();
    expect(result.current.errorAction).toBe('load your project categories');

    daemon.categoriesErrorRef.current = undefined; // the daemon recovers
    await act(async () => {
      await result.current.refresh();
    });

    // refresh() MAY clear an error IT raised — only a mutation refusal is protected.
    expect(result.current.error).toBeNull();
    expect(result.current.errorAction).toBeNull();
  });
});
