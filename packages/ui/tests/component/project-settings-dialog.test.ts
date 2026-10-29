/**
 * The project settings dialog — whose project it edits, what it lists, and how a hidden path is
 * removed (018 / US8, FR-041 … FR-047a).
 *
 * PLACE AT: `packages/ui/tests/component/project-settings-dialog.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/project-settings.e2e.ts` lines 76, 127, 169, 215 and the
 * dialog half of line 239 (034 FR-045).
 *
 * ══ WHY THESE PARTICULAR E2E TESTS COME DOWN ══
 *
 * Each of them launched Electron, created a project against a real temp folder, right-clicked two or
 * three files through the tree's context menu to get them into `hiddenPaths`, and then opened this
 * dialog — in order to read a list, a heading and a CSS class. Everything they asserted at that point
 * is this component rendering `activeProject.hiddenPaths` and `settings.explorer.excludeGlobs`.
 *
 * The two contexts it needs are both reachable from here without a production change, and that was
 * the thing worth checking before any of this was written:
 *
 *   - `ProjectsProvider` (`state/projects-store.tsx`) takes its client as a PROP. `ProjectsClient` is
 *     a class with a private field, so a structural stub is not assignable to it — but the class's
 *     own dependency, `ThrongBridge`, is an exported interface with ONE method. So the fake goes in
 *     one layer lower: a real `ProjectsClient` over a fake bridge. No cast, no `as unknown as`, and
 *     the store's real method names and refresh-after-mutation behaviour are exercised rather than
 *     stubbed away.
 *   - `ConfigContext` (`config/config-store.tsx`) has REAL defaults and no provider is needed, which
 *     is what makes the FR-047a overlap testable here at all: `**\/node_modules` is in the SHIPPED
 *     `explorer.excludeGlobs`, so a hidden path of `node_modules` is genuinely overlapped by the
 *     defaults. The E2E had to write `settings.json` and wait for a hot reload to manufacture the
 *     same state.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - `project-settings.e2e.ts:43`'s real half: un-hiding a path makes the FILE COME BACK IN THE TREE
 *     with no restart. That is a real project folder, a real explorer, and a store round trip — the
 *     list assertions it made on the way there are what move here.
 *   - The pane's options control in its ENABLED state (`project-settings.e2e.ts:239`), because
 *     reaching it means rendering `FileExplorerPane` with an active project, which mounts `FileTree`,
 *     which calls `useWorkspace` — a context that throws and whose provider subscribes to the daemon.
 *     Its DISABLED state has no such problem and lives in `file-explorer-pane.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { ProjectSettingsDialog } from '../../src/renderer/project-settings/project-settings-dialog.js';

const project = (
  id: string,
  name: string,
  hiddenPaths: string[],
  searchExcludeGlobs: string[] = [],
): ProjectDto => ({
  id,
  name,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths,
  searchExcludeGlobs,
});

/**
 * A fake daemon at the BRIDGE, not at the client.
 *
 * It holds the project list as real state and mutates it, because `setProjectHidden` is not a
 * fire-and-forget: the store re-`list()`s after every mutation and the dialog renders from that.
 * A bridge that echoed a canned reply would leave the removal test asserting nothing but its own
 * fixture.
 *
 * Every method that arrives is recorded. That is what lets one test below make a claim it otherwise
 * could not — that the dialog draws a row for a path WITHOUT asking anything about the path.
 */
function fakeDaemon(initial: ProjectDto[]) {
  let projects = initial.map((p) => ({ ...p, hiddenPaths: [...p.hiddenPaths] }));
  const methods: string[] = [];
  const setHiddenCalls: { id: string; hiddenPaths: string[] }[] = [];
  const setSearchExcludesCalls: { id: string; searchExcludeGlobs: string[] }[] = [];

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      methods.push(method);
      let reply: unknown;
      switch (method) {
        case 'projects.list':
          reply = { projects: projects.map((p) => ({ ...p, hiddenPaths: [...p.hiddenPaths] })) };
          break;
        case 'projects.categories.list':
          reply = { categories: [] };
          break;
        case 'projects.setActive':
          reply = { activeId: (params as { id: string }).id };
          break;
        case 'projects.setHidden': {
          const { id, hiddenPaths } = params as { id: string; hiddenPaths: string[] };
          setHiddenCalls.push({ id, hiddenPaths: [...hiddenPaths] });
          projects = projects.map((p) =>
            p.id === id ? { ...p, hiddenPaths: [...hiddenPaths] } : p,
          );
          reply = { project: projects.find((p) => p.id === id) };
          break;
        }
        case 'projects.setSearchExcludes': {
          const { id, searchExcludeGlobs } = params as { id: string; searchExcludeGlobs: string[] };
          setSearchExcludesCalls.push({ id, searchExcludeGlobs: [...searchExcludeGlobs] });
          projects = projects.map((p) =>
            p.id === id ? { ...p, searchExcludeGlobs: [...searchExcludeGlobs] } : p,
          );
          reply = { project: projects.find((p) => p.id === id) };
          break;
        }
        case 'projects.delete': {
          const { id } = params as { id: string };
          projects = projects.filter((p) => p.id !== id);
          reply = { deletedId: id, newActiveId: null };
          break;
        }
        default:
          return Promise.reject(new Error(`unexpected RPC from the dialog: ${method}`));
      }
      return Promise.resolve(reply as TResult);
    },
  };

  return { client: new ProjectsClient(bridge), methods, setHiddenCalls, setSearchExcludesCalls };
}

/**
 * The dialog, plus the three store commands the migrated tests reached through the sidebar.
 *
 * The dialog is rendered UNCONDITIONALLY rather than behind `activeProject`. That is deliberate and
 * it is the whole shape of the FR-046 test: if the host unmounted the dialog when the project went
 * away, the effect under test would never run and the test would pass on the host's behaviour
 * instead of the component's.
 */
function Host({ onClose }: { onClose: () => void }): ReactElement {
  const { activeProject, loading, switchProject, deleteProject } = useProjects();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'store-state' }, loading ? 'loading' : 'ready'),
    createElement('span', { 'data-testid': 'active-project' }, activeProject?.name ?? 'none'),
    createElement(
      'button',
      { 'data-testid': 'open-p1', onClick: () => void switchProject('p1') },
      'open p1',
    ),
    createElement(
      'button',
      { 'data-testid': 'open-p2', onClick: () => void switchProject('p2') },
      'open p2',
    ),
    createElement(
      'button',
      { 'data-testid': 'delete-p1', onClick: () => void deleteProject('p1') },
      'delete p1',
    ),
    createElement(ProjectSettingsDialog, { onClose }),
  );
}

async function mount(initial: ProjectDto[]) {
  const { client, methods, setHiddenCalls, setSearchExcludesCalls } = fakeDaemon(initial);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    createElement(ProjectsProvider, { client, children: createElement(Host, { onClose }) }),
  );
  // The store loads its list asynchronously on mount. Every test starts from a loaded store, so a
  // "no projects" assertion can never be a race with the first `projects.list`.
  await waitFor(() => expect(screen.getByTestId('store-state')).toHaveTextContent('ready'));
  return { user, onClose, methods, setHiddenCalls, setSearchExcludesCalls };
}

/**
 * Open a project and hand back a CLEAN `onClose` spy.
 *
 * The clear is load-bearing, not tidiness. `ProjectSettingsDialog` calls `onClose()` from an effect
 * whenever there is no active project — including on its very first render, before any project has
 * been opened. Without the clear, the FR-046 assertion below would already be satisfied by that
 * first mount and would pass with the effect deleted.
 */
async function openProject(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  onClose: ReturnType<typeof vi.fn>,
): Promise<void> {
  await user.click(screen.getByTestId(testId));
  await waitFor(() => expect(screen.getByTestId('project-settings-dialog')).toBeVisible());
  onClose.mockClear();
}

const dialog = (): HTMLElement => screen.getByTestId('project-settings-dialog');

/** The rows, by the class the migrated spec located them with. */
const rows = (): HTMLElement[] =>
  Array.from(dialog().querySelectorAll<HTMLElement>('li.hidden-path'));

const rowText = (): string[] => rows().map((r) => r.textContent ?? '');

describe('the dialog names the project it edits (FR-042)', () => {
  const two = [project('p1', 'First', ['a.txt']), project('p2', 'Second', ['c.txt'])];

  it('titles itself with the ACTIVE project and lists only that project’s hidden paths', async () => {
    // With several projects open and one dialog, "whose settings am I looking at?" must never be a
    // question the user answers by inference.
    const { user, onClose } = await mount(two);
    await openProject(user, 'open-p1', onClose);

    expect(dialog()).toHaveTextContent('First');
    expect(rowText()).toEqual([expect.stringContaining('a.txt')]);
    expect(dialog()).not.toHaveTextContent('c.txt');
  });

  it('follows a project switch instead of leaving the previous project’s paths on screen', async () => {
    /*
     * The second half is what makes the first one evidence. A dialog that read its project ONCE — on
     * mount, into local state — passes the test above and is wrong the moment the user switches: it
     * would go on showing `First` and `a.txt` while the application was in `Second`, which is the
     * lie FR-042 exists to prevent.
     */
    const { user, onClose } = await mount(two);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('open-p2'));
    await waitFor(() => expect(screen.getByTestId('active-project')).toHaveTextContent('Second'));

    expect(dialog()).toHaveTextContent('Second');
    expect(dialog()).not.toHaveTextContent('First');
    expect(rowText()).toEqual([expect.stringContaining('c.txt')]);
  });
});

describe('the hidden list, and the door it reopens (FR-043)', () => {
  const three = [project('p1', 'Demo', ['a.txt', 'b.txt', 'c.txt'])];

  it('lists every hidden path, one row each', async () => {
    const { user, onClose } = await mount(three);
    await openProject(user, 'open-p1', onClose);

    expect(rows()).toHaveLength(3);
    expect(rowText().join('|')).toContain('a.txt');
    expect(rowText().join('|')).toContain('b.txt');
    expect(rowText().join('|')).toContain('c.txt');
  });

  it('removing one writes the WHOLE list minus that path, and keeps the other two hidden', async () => {
    /*
     * The data-loss guard, and the reason this test asserts the RPC payload as well as the rendered
     * rows. `setHidden` REPLACES the list rather than removing from it, so the filter in `unhide` IS
     * the operation: a component that sent `[path]`, or `[]`, or the list unchanged, would either
     * drop every other hidden path on the floor — silently, with the list the only record of them —
     * or do nothing at all behind a button that looked like it worked.
     *
     * The rendered half alone cannot see the difference between "wrote the right list" and "wrote
     * nothing and re-rendered from a stale copy"; the payload half alone cannot see whether the
     * dialog then showed the result. Both, or neither means much.
     */
    const { user, onClose, setHiddenCalls } = await mount(three);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('hidden-path-remove-b.txt'));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(setHiddenCalls).toEqual([{ id: 'p1', hiddenPaths: ['a.txt', 'c.txt'] }]);
    expect(rowText().join('|')).toContain('a.txt');
    expect(rowText().join('|')).toContain('c.txt');
    expect(rowText().join('|')).not.toContain('b.txt');
  });

  it('says so, in words, when nothing is hidden', async () => {
    // The empty state is the first thing a user who has never hidden anything sees. An empty <ul>
    // reads as a broken dialog.
    const { user, onClose } = await mount([project('p1', 'Demo', [])]);
    await openProject(user, 'open-p1', onClose);

    expect(screen.getByTestId('project-settings-empty')).toBeVisible();
    expect(rows()).toHaveLength(0);
  });

  it('lists a path with nothing behind it, without asking anything about the path', async () => {
    /*
     * MIGRATED FROM `project-settings.e2e.ts:215`, where the file was created, hidden, and then
     * DELETED from disk before the dialog was opened. The user hides a build artefact and then
     * cleans; the list names PATHS, not files.
     *
     * The renderer cannot stat anything itself — it has no filesystem — so the only way this
     * component could have depended on the path existing is by ASKING the daemon. That is what the
     * recorded method list rules out: the rows are drawn, and the removal works, having sent nothing
     * but the store's own list/categories.list/setActive/setHidden traffic.
     */
    const { user, onClose, methods } = await mount([project('p1', 'Demo', ['build/gone.js'])]);
    await openProject(user, 'open-p1', onClose);

    expect(rows()).toHaveLength(1);
    expect(rowText()[0]).toContain('build/gone.js');
    expect(
      methods.filter(
        (m) => m !== 'projects.list' && m !== 'projects.categories.list' && m !== 'projects.setActive',
      ),
    ).toEqual([]);

    await user.click(screen.getByTestId('hidden-path-remove-build/gone.js'));
    await waitFor(() => expect(rows()).toHaveLength(0));
  });
});

describe('a path that is ALSO glob-excluded is marked (FR-047a)', () => {
  /*
   * `node_modules` is in the SHIPPED `explorer.excludeGlobs` (033 FR-070), and ConfigContext's
   * defaults are real — so the overlap this requirement is about exists here with no provider, no
   * settings write and no hot reload. `b.txt` matches none of the shipped globs, which is what makes
   * the negative case a different state rather than a different assertion.
   *
   * Whether the PREDICATE is right is `packages/core/tests/unit/explorer-exclude.test.ts`'s job.
   * What is asserted here is that the dialog asks it, per row, and says something when it answers yes.
   */
  const overlapped = [project('p1', 'Demo', ['node_modules', 'b.txt'])];

  const row = (text: string): HTMLElement =>
    rows().find((r) => (r.textContent ?? '').includes(text)) as HTMLElement;

  it('marks the overlapped row and says that removing it will not bring the file back', async () => {
    // A remove button that visibly does nothing is a worse defect than the one this dialog fixes.
    const { user, onClose } = await mount(overlapped);
    await openProject(user, 'open-p1', onClose);

    expect(row('node_modules')).toHaveClass('hidden-path--also-excluded');
    expect(row('node_modules').textContent ?? '').toMatch(/exclusion|excluded/i);
  });

  it('leaves a merely-hidden path unmarked, because removing THAT one really works', async () => {
    const { user, onClose } = await mount(overlapped);
    await openProject(user, 'open-p1', onClose);

    expect(row('b.txt')).not.toHaveClass('hidden-path--also-excluded');
    expect(row('b.txt').textContent ?? '').not.toMatch(/exclusion|excluded/i);
  });

  it('states that the global exclusions apply as well, and names them (FR-047)', async () => {
    // The hidden list is not the whole story. A user who believes it is will not understand why a
    // file they never hid is still missing.
    const { user, onClose } = await mount(overlapped);
    await openProject(user, 'open-p1', onClose);

    const globals = screen.getByTestId('project-settings-globals');
    expect(globals).toHaveTextContent(/exclusion/i);
    expect(globals).toHaveTextContent('**/node_modules');
  });
});

describe('the dialog never edits a ghost (FR-046)', () => {
  it('asks to close when the project it was editing is deleted out from under it', async () => {
    /*
     * MIGRATED FROM `project-settings.e2e.ts:127`, which spent a project creation, a hidden path, a
     * dispatched click through a modal overlay and a DOUBLE confirmation to arrive at exactly this:
     * the active project became null while the dialog was open. The state change never arrives by
     * the user clicking behind the dialog — the overlay is in the way — it arrives from elsewhere,
     * which is precisely why the store, not a pointer, produces it here.
     */
    const { user, onClose } = await mount([project('p1', 'Doomed', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('delete-p1'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does NOT ask to close while its project is still there', async () => {
    /*
     * The negative half. Without it, an effect that called `onClose()` unconditionally — on every
     * render, or on any change to the projects list — satisfies the test above perfectly, and would
     * make the dialog impossible to keep open at all.
     */
    const { user, onClose } = await mount([project('p1', 'Demo', ['a.txt', 'b.txt'])]);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('hidden-path-remove-a.txt'));
    await waitFor(() => expect(rows()).toHaveLength(1));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('leaving the dialog', () => {
  const one = [project('p1', 'Demo', ['a.txt'])];

  it('closes on Escape', async () => {
    const { user, onClose } = await mount(one);
    await openProject(user, 'open-p1', onClose);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a click on the overlay, but NOT on a click inside the dialog', async () => {
    /*
     * Both halves, because they are one mechanism: the overlay closes on click and the dialog stops
     * that click propagating. Drop the `stopPropagation` and every click on a row, a path or the
     * remove button dismisses the dialog — which the positive half alone cannot see.
     */
    const { user, onClose } = await mount(one);
    await openProject(user, 'open-p1', onClose);

    await user.click(dialog());
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('project-settings-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  /* Hand-test 2026-10-29 (060 FR-044): a ✕ in the title row replaces the Close button at the foot. */
  it('closes from the ✕ in its title row, and has no Close button', async () => {
    const { user, onClose } = await mount(one);
    await openProject(user, 'open-p1', onClose);

    const close = screen.getByTestId('project-settings-close');
    expect(close.closest('.project-settings__header')).not.toBeNull();
    expect(close.querySelectorAll('.icon')).toHaveLength(1);
    expect(close).toHaveAttribute('title', expect.stringMatching(/close/i));
    expect(screen.queryByRole('button', { name: /^Close$/ })).toBeNull();

    await user.click(close);
    expect(onClose).toHaveBeenCalled();
  });
});

/* Hand-test 2026-10-29 (060 FR-044): each section reaches the Preferences list behind its note. */
describe('each section opens Preferences for its global list', () => {
  afterEach(() => {
    delete (window as unknown as { throng?: unknown }).throng;
  });

  it.each([
    ['project-settings-explorer', 'project-settings-explorer-prefs'],
    ['project-settings-search', 'project-settings-search-prefs'],
  ])('%s: an icon control that closes the dialog and opens the Settings tab', async (section, control) => {
    const openPreferences = vi.fn();
    (window as unknown as { throng: unknown }).throng = { openPreferences };
    const { user, onClose } = await mount([project('p1', 'Demo', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);

    const button = within(screen.getByTestId(section)).getByTestId(control);
    expect(button.querySelectorAll('.icon')).toHaveLength(1);
    expect(button).toHaveAttribute('title', expect.stringMatching(/Preferences/));

    await user.click(button);
    expect(openPreferences).toHaveBeenCalledWith('settings');
    expect(onClose).toHaveBeenCalled();
  });
});

/*
 * ══ 060 #532 (T052, FR-035, FR-036) — TWO SECTIONS, AND THE LAYOUT THAT REPLACED THE ONE-LIST DIALOG ══
 *
 * The title is kept (FR-035). What changed is that the single "Hidden files & folders" list became
 * "Hidden in File Explorer", and "Hidden to Find & Replace" joined it, each with its own list, its own
 * add row and its own note naming the global list that ALSO applies. The assertions above that read
 * `li.hidden-path` and the `hidden-path-remove-*` ids are unchanged on purpose: the explorer section
 * IS the old list, and those are still the evidence that it works. Only the lines that depended on
 * there being one section are rewritten below.
 */
const sectionOf = (name: RegExp): HTMLElement => {
  const heading = within(dialog())
    .getAllByRole('heading', { level: 4 })
    .find((h) => name.test(h.textContent ?? ''));
  if (!heading) throw new Error(`no section heading matching ${String(name)}`);
  return heading.closest('section') as HTMLElement;
};
const explorerSection = (): HTMLElement => sectionOf(/hidden in file explorer/i);
const searchSection = (): HTMLElement => sectionOf(/hidden to find & replace/i);

describe('two sections under the unchanged title (FR-035)', () => {
  const p = [project('p1', 'Demo', ['a.txt'], ['**/gen', 'src/old'])];

  it('keeps the “<project> — project settings” title', async () => {
    const { user, onClose } = await mount(p);
    await openProject(user, 'open-p1', onClose);
    expect(screen.getByRole('dialog', { name: 'Demo — project settings' })).toBeVisible();
  });

  it('draws “Hidden in File Explorer” holding the hidden paths, and not the search globs', async () => {
    const { user, onClose } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    expect(explorerSection()).toHaveTextContent('a.txt');
    expect(explorerSection()).not.toHaveTextContent('**/gen');
  });

  it('draws “Hidden to Find & Replace” holding the search globs, and not the hidden paths', async () => {
    const { user, onClose } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    expect(searchSection()).toHaveTextContent('**/gen');
    expect(searchSection()).toHaveTextContent('src/old');
    expect(searchSection()).not.toHaveTextContent('a.txt');
  });

  it('names the global list that also applies, in each section', async () => {
    const { user, onClose } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    // Explorer: `explorer.excludeGlobs`, whose shipped default carries `**/node_modules`.
    expect(within(explorerSection()).getByTestId('project-settings-globals')).toHaveTextContent(
      '**/node_modules',
    );
    // Search: `search.inFiles.excludeGlobs`, which has its own shipped default.
    const note = within(searchSection()).getByTestId('project-settings-search-globals');
    expect(note).toHaveTextContent(DEFAULT_APP_SETTINGS.search.inFiles.excludeGlobs[0]!);
  });

  it('says so, in words, when nothing is hidden from search', async () => {
    const { user, onClose } = await mount([project('p1', 'Demo', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);
    expect(screen.getByTestId('project-settings-search-empty')).toBeVisible();
  });
});

describe('the Hidden in File Explorer add box (FR-035)', () => {
  it('adds a project-relative path to hiddenPaths on Enter, keeping what was already hidden', async () => {
    const { user, onClose, setHiddenCalls } = await mount([project('p1', 'Demo', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);

    await user.type(screen.getByTestId('hidden-path-add-input'), 'build/out{Enter}');

    await waitFor(() => expect(rowText().join('|')).toContain('build/out'));
    expect(setHiddenCalls).toEqual([{ id: 'p1', hiddenPaths: ['a.txt', 'build/out'] }]);
    expect(screen.getByTestId('hidden-path-add-input')).toHaveValue('');
  });

  it('adds from the add button, and normalises a pasted path to project-relative form', async () => {
    const { user, onClose, setHiddenCalls } = await mount([project('p1', 'Demo', [])]);
    await openProject(user, 'open-p1', onClose);

    await user.type(screen.getByTestId('hidden-path-add-input'), ' \\build\\out\\ ');
    await user.click(screen.getByTestId('hidden-path-add'));

    await waitFor(() => expect(setHiddenCalls).toHaveLength(1));
    expect(setHiddenCalls[0]).toEqual({ id: 'p1', hiddenPaths: ['build/out'] });
  });

  it('adds nothing for an empty box or a path already hidden', async () => {
    const { user, onClose, setHiddenCalls } = await mount([project('p1', 'Demo', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('hidden-path-add'));
    await user.type(screen.getByTestId('hidden-path-add-input'), 'a.txt{Enter}');

    expect(setHiddenCalls).toEqual([]);
  });

  it('is an icon control with a title, no word (Constitution VI)', async () => {
    const { user, onClose } = await mount([project('p1', 'Demo', [])]);
    await openProject(user, 'open-p1', onClose);

    const add = screen.getByTestId('hidden-path-add');
    expect(add.querySelectorAll('.icon')).toHaveLength(1);
    expect(add).toHaveAttribute('title', expect.stringMatching(/hide/i));
  });
});

describe('the Hidden to Find & Replace list (FR-030, FR-035)', () => {
  const p = [project('p1', 'Demo', [], ['**/gen', 'src/old'])];

  it('adds a glob on Enter, keeping the others', async () => {
    const { user, onClose, setSearchExcludesCalls } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    await user.type(screen.getByTestId('search-exclude-add-input'), '*.snap{Enter}');

    await waitFor(() => expect(searchSection()).toHaveTextContent('*.snap'));
    expect(setSearchExcludesCalls).toEqual([
      { id: 'p1', searchExcludeGlobs: ['**/gen', 'src/old', '*.snap'] },
    ]);
  });

  it('removes one by its ✕, writing the WHOLE list minus it', async () => {
    const { user, onClose, setSearchExcludesCalls } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('search-exclude-remove-**/gen'));

    await waitFor(() => expect(searchSection()).not.toHaveTextContent('**/gen'));
    expect(setSearchExcludesCalls).toEqual([{ id: 'p1', searchExcludeGlobs: ['src/old'] }]);
  });

  it('adds nothing, and says why once, for a pattern that cannot be compiled', async () => {
    const { user, onClose, setSearchExcludesCalls } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    await user.type(screen.getByTestId('search-exclude-add-input'), '[[{Enter}');

    expect(setSearchExcludesCalls).toEqual([]);
    expect(screen.getAllByTestId('search-exclude-notice')).toHaveLength(1);
    expect(screen.getByTestId('search-exclude-notice')).toHaveTextContent('[');
  });

  it('adds nothing for a glob that is already listed', async () => {
    const { user, onClose, setSearchExcludesCalls } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    await user.type(screen.getByTestId('search-exclude-add-input'), '**/gen{Enter}');

    expect(setSearchExcludesCalls).toEqual([]);
  });

  it('draws icon controls with titles that name the entry', async () => {
    const { user, onClose } = await mount(p);
    await openProject(user, 'open-p1', onClose);

    const remove = screen.getByTestId('search-exclude-remove-src/old');
    expect(remove.querySelectorAll('.icon')).toHaveLength(1);
    expect(remove).toHaveAttribute('title', expect.stringContaining('src/old'));
    expect(screen.getByTestId('search-exclude-add').querySelectorAll('.icon')).toHaveLength(1);
  });
});

describe('each list scrolls on its own and Close stays in view (FR-036)', () => {
  const many = Array.from({ length: 60 }, (_, i) => `dir/file-${i}.txt`);

  it('gives each section its OWN list container, with Close outside both', async () => {
    const { user, onClose } = await mount([project('p1', 'Demo', many, many.map((m) => `**/${m}`))]);
    await openProject(user, 'open-p1', onClose);

    const explorerList = within(explorerSection()).getByTestId('project-settings-list');
    const searchList = within(searchSection()).getByTestId('project-settings-search-list');
    expect(explorerList).not.toBe(searchList);
    expect(explorerList.contains(searchList)).toBe(false);
    expect(searchList.contains(explorerList)).toBe(false);

    const close = screen.getByTestId('project-settings-close');
    expect(explorerList.contains(close)).toBe(false);
    expect(searchList.contains(close)).toBe(false);
    expect(explorerSection().contains(close)).toBe(false);
    expect(searchSection().contains(close)).toBe(false);
  });

  it('puts the add row OUTSIDE the scrolling list, so a long list never scrolls it away', async () => {
    const { user, onClose } = await mount([project('p1', 'Demo', many, many)]);
    await openProject(user, 'open-p1', onClose);

    const explorerList = within(explorerSection()).getByTestId('project-settings-list');
    const searchList = within(searchSection()).getByTestId('project-settings-search-list');
    expect(explorerList.contains(screen.getByTestId('hidden-path-add-input'))).toBe(false);
    expect(searchList.contains(screen.getByTestId('search-exclude-add-input'))).toBe(false);
  });

  /*
   * The scrolling itself is a CSS claim, and jsdom lays nothing out — so it is asserted over the
   * stylesheet's source, as `find-in-files-results.test.ts` does for its own sheet rather than
   * pretending `getComputedStyle` could see a scrollbar. The rendered half is the structure above.
   */
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/project-settings/project-settings.css'),
    'utf8',
  );
  const rule = (selector: string): string => {
    const found = new RegExp(`(^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!found) throw new Error(`no ${selector} rule in project-settings.css`);
    return found[2] ?? '';
  };

  it('caps each list and scrolls it', () => {
    expect(rule('.project-settings__list')).toMatch(/max-height:/);
    expect(rule('.project-settings__list')).toMatch(/overflow-y:\s*auto/);
  });

  /*
   * Hand-test 2026-10-29: the dialog showed its title and Close and NEITHER section. Each section was
   * `flex: 1 1 0` with `min-height: 0` in a column that has a max-height and no height, so Chromium
   * sized the column from those zero bases, and the sections' `overflow: hidden` hid everything. A
   * section is sized by its content and may only SHRINK, which is what a cap needs.
   */
  it('sizes each section by its content, never from a zero basis', () => {
    expect(rule('.project-settings__group')).not.toMatch(/flex:\s*\d+\s+\d+\s+0(px)?\s*;/);
    expect(rule('.project-settings__group')).toMatch(/flex:\s*0\s+1\s+auto/);
  });

  /*
   * Hand-test 2026-10-29 (060 FR-044): a row's remove ✕ sits in line with its section's add ＋. The
   * rows are padded inside their hover box, so the add row takes the same inline padding.
   */
  it('lines up each row’s remove control with the add control above it', () => {
    const padding = (selector: string): string | undefined =>
      /padding:\s*([^;]+);/.exec(rule(selector))?.[1]?.trim();
    // `.hidden-path, .search-exclude` is one rule; the helper finds it by its last selector.
    const row = padding('.search-exclude') ?? '';
    const inline = row.split(/\s+/)[1];
    expect(inline, 'the rows declare an inline padding').toBeTruthy();
    expect(rule('.project-settings__add')).toMatch(new RegExp(`padding:\\s*0\\s+${inline!.replace('.', '\\.')}\\s*;`));
  });

  it('caps the dialog to the viewport so nothing pushes Close off screen', () => {
    expect(rule('.project-settings')).toMatch(/max-height:\s*calc\(100vh/);
    expect(rule('.project-settings')).toMatch(/display:\s*flex/);
    expect(rule('.project-settings')).toMatch(/flex-direction:\s*column/);
  });
});

describe('the per-row remove control is a themed icon with a title (FR-043a)', () => {
  it('names the path it would un-hide, draws one icon, and carries no word "Remove"', async () => {
    /*
     * MIGRATED FROM the dialog half of `project-settings.e2e.ts:239`. A per-row affordance is NOT a
     * dialog decision button, so the constitution's one exception to the themeable-icon rule does
     * not cover it: it must be an icon from the active pack, and it must say what it does on hover.
     *
     * The title names the PATH rather than the action alone, which is what makes it usable in a list
     * of ten identical-looking buttons.
     */
    const { user, onClose } = await mount([project('p1', 'Demo', ['a.txt'])]);
    await openProject(user, 'open-p1', onClose);

    const remove = screen.getByTestId('hidden-path-remove-a.txt');
    expect(remove).toHaveAttribute('title', expect.stringContaining('a.txt'));
    expect(remove.querySelectorAll('.icon')).toHaveLength(1);
    expect(remove.textContent ?? '').not.toMatch(/remove/i);
  });
});
