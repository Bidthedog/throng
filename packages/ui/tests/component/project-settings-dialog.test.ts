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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { ProjectSettingsDialog } from '../../src/renderer/project-settings/project-settings-dialog.js';

const project = (id: string, name: string, hiddenPaths: string[]): ProjectDto => ({
  id,
  name,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths,
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

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      methods.push(method);
      let reply: unknown;
      switch (method) {
        case 'projects.list':
          reply = { projects: projects.map((p) => ({ ...p, hiddenPaths: [...p.hiddenPaths] })) };
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

  return { client: new ProjectsClient(bridge), methods, setHiddenCalls };
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
  const { client, methods, setHiddenCalls } = fakeDaemon(initial);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    createElement(ProjectsProvider, { client, children: createElement(Host, { onClose }) }),
  );
  // The store loads its list asynchronously on mount. Every test starts from a loaded store, so a
  // "no projects" assertion can never be a race with the first `projects.list`.
  await waitFor(() => expect(screen.getByTestId('store-state')).toHaveTextContent('ready'));
  return { user, onClose, methods, setHiddenCalls };
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
     * but the store's own list/setActive/setHidden traffic.
     */
    const { user, onClose, methods } = await mount([project('p1', 'Demo', ['build/gone.js'])]);
    await openProject(user, 'open-p1', onClose);

    expect(rows()).toHaveLength(1);
    expect(rowText()[0]).toContain('build/gone.js');
    expect(methods.filter((m) => m !== 'projects.list' && m !== 'projects.setActive')).toEqual([]);

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

  it('closes from its Close button', async () => {
    const { user, onClose } = await mount(one);
    await openProject(user, 'open-p1', onClose);

    await user.click(screen.getByTestId('project-settings-close'));

    expect(onClose).toHaveBeenCalled();
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
