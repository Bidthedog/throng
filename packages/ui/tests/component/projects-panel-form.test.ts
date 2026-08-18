/**
 * The Projects panel's own state: the create/edit form, the inline rename box, and the tab/panel
 * counts beside each project name (002 FR-026/027/028/029; 011; 019 counts).
 *
 * PLACE AT: `packages/ui/tests/component/projects-panel-form.test.ts`
 * MIGRATED FROM (034 FR-045):
 *   - `packages/ui/tests/e2e/project-creation.e2e.ts`     — both tests
 *   - `packages/ui/tests/e2e/project-counts.e2e.ts`       — both tests
 *   - `packages/ui/tests/e2e/project-rename-guard.e2e.ts` — both tests
 *
 * ══ WHY THESE COME DOWN ══
 *
 * All six launched Electron and a daemon (two of them also made a real temp folder) in order to ask
 * what `projects-panel.tsx` puts on screen when a create is refused, when a rename is refused, and
 * when the layout gains a tab. Every one of those answers is renderer state: `draft`, `renamingId`,
 * `folderError`/`nameError`, and the counts ternary at `projects-panel.tsx:455`.
 *
 * The two contexts that used to make this look E2E-only are both reachable here, and both were
 * checked before a line of this was written:
 *
 *   - `WorkspaceProvider` is EXPORTED and takes its client as a prop, so the real store mounts over
 *     a fake `ThrongBridge` (the `subworkspace-sync.test.ts` / `file-tree.test.ts` idiom). That is
 *     what makes the LIVE counts reachable: adding a tab here goes through the same
 *     `opAddTab` the strip's `+` dispatches.
 *   - `ProjectsProvider` takes a `ProjectsClient`, itself a one-method class over `ThrongBridge`.
 *
 * ══ WHERE THESE LAND STRONGER THAN THE E2E DID ══
 *
 *   - The rejections are produced by the REAL rules. `projects.create` / `projects.update` in the
 *     fake daemon below call `validateProjectInput` and `assertFolderExclusive` from `@throng/core`
 *     — the same functions the daemon's project service calls — so the message the form classifies
 *     into `folderError` vs `nameError` is the genuine sentence, not a string invented to match the
 *     regex it is about to be tested against. A test that fabricated `'bad folder'` would keep
 *     passing after the real wording changed.
 *   - `project-counts.e2e.ts:30` waited out a `waitForTimeout(900)` for the layout autosave and then
 *     asserted a number. Here the persisted counts are DERIVED by the fake daemon from the layout it
 *     was actually sent, and the test waits for that save to arrive rather than for a clock — so the
 *     autosave claim the E2E's sleep stood in for is asserted instead of assumed.
 *   - `project-creation.e2e.ts:7` asserted only that the colour input held SOME hex. FR-027 asks for
 *     an UNUSED one, so here two projects hold two palette colours and the new draft's colour is
 *     asserted to be neither.
 *
 * ══ WHAT DOES NOT COME DOWN, AND WHY ══
 *
 *   - `new-project-folder.e2e.ts` (all four) stays: the picker's `defaultPath` cascade is resolved in
 *     UI-main against a real filesystem, and the renderer contributes an empty `profileDir`.
 *   - `project-browse-neutral.e2e.ts` stays: three computed colours and a `:hover` (FR-049).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, render `tree` WITHOUT the `ProjectsProvider` element — i.e. drop the outermost
 * `createElement(ProjectsProvider, …)` and render its child directly. `ProjectsPanel` calls
 * `useProjects()` unconditionally, which throws `useProjects must be used within a ProjectsProvider`,
 * so the render fails before any assertion runs. **ALL SIX tests in this file fail.** No absence
 * assertion here ("the form is gone", "no error") can be satisfied by an empty document, because
 * every test reaches its subject through `mount()` and every one of them asserts something PRESENT
 * first (the form, the row, the counts) before asserting anything absent.
 */
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFolderExclusive,
  countPanels,
  createDefaultLayout,
  SUBWORKSPACE_PALETTE,
  validateProjectInput,
  type WorkspaceLayout,
} from '@throng/core';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';

/*
 * `crypto.randomUUID`, which `workspace-store.tsx:66` uses for every new tab and panel id.
 *
 * Conditional, and deliberately not a blanket stub: on a jsdom that already provides it the real one
 * is used, and the shim only fills a genuine gap. Ids are compared for INEQUALITY here and never for
 * shape, so a counter is a faithful stand-in.
 */
let uuidSeq = 0;
beforeAll(() => {
  const existing = Reflect.get(globalThis, 'crypto') as { randomUUID?: unknown } | undefined;
  if (!existing) {
    Reflect.set(globalThis, 'crypto', { randomUUID: () => `id-${(uuidSeq += 1)}` });
  } else if (typeof existing.randomUUID !== 'function') {
    Reflect.set(existing, 'randomUUID', () => `id-${(uuidSeq += 1)}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A fake daemon at the BRIDGE, enforcing the REAL rules
 * ────────────────────────────────────────────────────────────────────────── */

const PALETTE_A = SUBWORKSPACE_PALETTE[0];
const PALETTE_B = SUBWORKSPACE_PALETTE[1];

function dto(id: string, name: string, colour: string, rootFolder: string): ProjectDto {
  return {
    id,
    name,
    colour,
    rootFolder,
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  };
}

/**
 * The daemon, as far as this panel can tell.
 *
 * Two things it does NOT do, on purpose. It does not echo canned replies for `projects.create` /
 * `projects.update`: it runs `validateProjectInput` and `assertFolderExclusive`, so a rejection here
 * is the production rejection with the production wording, and the form's `/folder/i` and `/name/i`
 * classification is tested against the sentences it will actually meet. And it does not fabricate
 * `tabCount` / `panelCount`: they are derived from the layout it was SENT, so a counts assertion for
 * a closed project is evidence that a save really landed.
 */
function fakeDaemon(seed: ProjectDto[] = []) {
  let projects = seed.map((p) => ({ ...p }));
  const layouts = new Map<string, WorkspaceLayout>();
  const saved: WorkspaceLayout[] = [];
  let seq = 0;

  const listed = (): ProjectDto[] =>
    projects.map((p) => {
      const layout = layouts.get(p.id);
      return {
        ...p,
        tabCount: layout ? layout.tabs.length : 0,
        panelCount: layout
          ? layout.tabs.reduce((n, t) => n + countPanels(t.root), 0)
          : 0,
      };
    });

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      let reply: unknown;
      switch (method) {
        case 'projects.list':
          reply = { projects: listed() };
          break;

        case 'projects.create': {
          const input = params as { name: string; colour: string; rootFolder: string };
          try {
            const clean = validateProjectInput(input);
            assertFolderExclusive(clean.rootFolder, projects);
            const created = dto(`p${(seq += 1)}`, clean.name, clean.colour, clean.rootFolder);
            projects = [...projects, created];
            reply = { project: created };
          } catch (err) {
            return Promise.reject(err);
          }
          break;
        }

        case 'projects.update': {
          const patch = params as { id: string; name?: string; colour?: string; rootFolder?: string };
          const current = projects.find((p) => p.id === patch.id);
          if (!current) return Promise.reject(new Error(`no such project: ${patch.id}`));
          try {
            const clean = validateProjectInput({
              name: patch.name ?? current.name,
              colour: patch.colour ?? current.colour,
              rootFolder: patch.rootFolder ?? current.rootFolder,
            });
            assertFolderExclusive(clean.rootFolder, projects, patch.id);
            const next = { ...current, ...clean };
            projects = projects.map((p) => (p.id === patch.id ? next : p));
            reply = { project: next };
          } catch (err) {
            return Promise.reject(err);
          }
          break;
        }

        case 'projects.setActive':
          reply = { activeId: (params as { id: string }).id };
          break;

        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const stored = layouts.get(projectId);
          if (stored) {
            reply = { layout: stored, restored: true };
          } else {
            reply = {
              layout: createDefaultLayout(projectId, {
                tab: `t${(seq += 1)}`,
                panel: `pn${(seq += 1)}`,
              }),
              restored: false,
            };
          }
          break;
        }

        case 'workspace.save': {
          const { projectId, layout } = params as { projectId: string; layout: WorkspaceLayout };
          layouts.set(projectId, layout);
          saved.push(layout);
          reply = { ok: true };
          break;
        }

        default:
          return Promise.reject(new Error(`unexpected RPC from the projects panel: ${method}`));
      }
      return Promise.resolve(reply as TResult);
    },
  };

  return {
    bridge,
    saved,
    /** What the daemon now holds for a project — i.e. what was actually written. */
    layoutOf: (projectId: string): WorkspaceLayout | undefined => layouts.get(projectId),
    names: (): string[] => projects.map((p) => p.name),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

/** The workspace store, pointed at whichever project the projects store has open. */
function WorkspaceForActiveProject({
  client,
  children,
}: {
  client: WorkspaceClient;
  children: ReactNode;
}): ReactElement {
  const { activeProject } = useProjects();
  return createElement(WorkspaceProvider, {
    client,
    activeProjectId: activeProject?.id ?? null,
    children,
  });
}

/**
 * The panel, plus the two workspace commands `project-counts.e2e.ts` reached through the tab strip.
 *
 * `addTab` / `addPanel` are the SAME context methods `tab-group.tsx:505`'s `tab-add` and
 * `panel-placeholder.tsx:714`'s `panel-add-<id>` call — the strip is not mounted because nothing
 * here asserts anything about the strip.
 */
function Host(): ReactElement {
  const ws = useWorkspace();
  return createElement(
    'div',
    null,
    createElement(
      'span',
      { 'data-testid': 'layout-state', key: 'state' },
      ws.layout ? `loaded:${ws.layout.projectId}` : 'none',
    ),
    createElement(
      'button',
      { 'data-testid': 'add-tab', key: 'addtab', onClick: () => ws.addTab() },
      'add tab',
    ),
    createElement(
      'button',
      {
        'data-testid': 'add-panel',
        key: 'addpanel',
        onClick: () => {
          if (ws.layout) ws.addPanel(ws.layout.activeTabId);
        },
      },
      'add panel',
    ),
    createElement(ProjectsPanel, { key: 'panel' }),
  );
}

interface Stubs {
  /** What the OS folder dialog returns; `undefined` means the user cancelled. */
  picked?: string;
}

let pickFolder: ReturnType<typeof vi.fn>;

function stubWindowThrong(stubs: Stubs) {
  pickFolder = vi.fn(() => Promise.resolve(stubs.picked));
  Reflect.set(window, 'throng', {
    pickFolder,
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: { onChanged: () => () => {}, notifyChanged: () => {} },
    panels: { publishIdentities: () => {} },
    config: { writePatch: () => Promise.resolve({ ok: true }) },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

beforeEach(() => {
  localStorage.clear();
});

async function mount(seed: ProjectDto[] = [], stubs: Stubs = {}) {
  stubWindowThrong(stubs);
  const daemon = fakeDaemon(seed);
  const projectsClient = new ProjectsClient(daemon.bridge);
  const workspaceClient = new WorkspaceClient(daemon.bridge);
  const user = userEvent.setup();

  // ANTI-VACUITY CONTROL: delete this `ProjectsProvider` element (render its child directly) and
  // `useProjects` throws inside `ProjectsPanel`, failing all six tests. See the file header.
  const tree = createElement(ProjectsProvider, {
    client: projectsClient,
    children: createElement(WorkspaceForActiveProject, {
      client: workspaceClient,
      children: createElement(
        NotificationProvider,
        null,
        createElement(ConfirmProvider, null, createElement(Host, null)),
      ),
    }),
  });

  render(tree);

  // Every test starts from a LOADED list, so an "empty"/"absent" assertion can never be a race with
  // the store's first `projects.list`.
  await waitFor(() => {
    expect(screen.getByTestId('projects-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('project-list')).not.toBeNull();
  });
  return { user, daemon };
}

/**
 * The first `project-error` notice on screen.
 *
 * `getAllBy`, not `getBy`, and for the same reason `project-creation.e2e.ts` wrote `.first()`: two
 * refusals with DIFFERENT sentences are two notices, because the duplicate rule keys on the message
 * as well as the surface. A `getByTestId` here would fail on "found multiple elements" the moment a
 * test refused twice — a failure that says nothing about the behaviour under test.
 */
const projectError = (): HTMLElement => screen.getAllByTestId('project-error')[0];

/** The counts chip for a project row, by NAME (the sidebar accumulates rows across a test). */
const countsOf = (name: string): HTMLElement => {
  const row = screen
    .getAllByTestId(/^project-item-/)
    .find((el) => (el.textContent ?? '').includes(name));
  if (!row) throw new Error(`no project row named ${name}`);
  return within(row).getByTestId(/^project-counts-/);
};

/** `harness.ts:710`'s `createProject`, one layer down. */
async function createProject(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  root: string,
): Promise<void> {
  await user.click(screen.getByTestId('project-new'));
  await waitFor(() => expect(screen.getByTestId('project-form')).toBeVisible());
  const rootInput = screen.getByTestId('project-root-input');
  await user.clear(rootInput);
  await user.type(rootInput, root);
  const nameInput = screen.getByTestId('project-name-input');
  await user.clear(nameInput);
  await user.type(nameInput, name);
  await user.click(screen.getByTestId('project-save'));
  await waitFor(() => expect(screen.queryByTestId('project-form')).toBeNull());
  // Created means OPENED (`projects-store.tsx:209`), which is what the counts below read.
  await waitFor(() =>
    expect(screen.getByTestId('layout-state')).toHaveTextContent(/^loaded:/),
  );
}

const projectIdOf = (name: string): string => {
  const row = screen
    .getAllByTestId(/^project-item-/)
    .find((el) => (el.textContent ?? '').includes(name));
  if (!row) throw new Error(`no project row named ${name}`);
  return (row.getAttribute('data-testid') ?? '').replace('project-item-', '');
};

/* ────────────────────────────────────────────────────────────────────────── *
 * project-creation.e2e.ts
 * ────────────────────────────────────────────────────────────────────────── */

describe('the create form, once a folder has been picked (FR-026/027)', () => {
  it('auto-fills and SELECTS the name from the picked folder, in an unused accent colour', async () => {
    /*
     * MIGRATED FROM `project-creation.e2e.ts:7`.
     *
     * Two projects are seeded holding two palette colours, which the E2E did not do — it asserted
     * only that the colour field held some hex, which `pickInitialColour` satisfies even with the
     * "not already used" filter deleted. FR-027 asks for an UNUSED colour, so that is what is
     * asserted.
     */
    const { user } = await mount(
      [
        dto('seed-a', 'Seed A', PALETTE_A, 'C:/code/seed-a'),
        dto('seed-b', 'Seed B', PALETTE_B, 'C:/code/seed-b'),
      ],
      { picked: 'C:\\code\\AutoName' },
    );

    await user.click(screen.getByTestId('project-new'));
    await waitFor(() => expect(screen.getByTestId('project-form')).toBeVisible());

    // The picker pops on mount (`FolderPicker` autoOpenOnMount) and its answer fills the path…
    await waitFor(() =>
      expect(screen.getByTestId('project-root-input')).toHaveValue('C:\\code\\AutoName'),
    );
    // …and names the project after its basename.
    await waitFor(() => expect(screen.getByTestId('project-name-input')).toHaveValue('AutoName'));
    expect(pickFolder).toHaveBeenCalledTimes(1);

    const colour = screen.getByTestId('project-colour-input') as HTMLInputElement;
    expect(colour.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colour.value.toLowerCase()).not.toBe(PALETTE_A.toLowerCase());
    expect(colour.value.toLowerCase()).not.toBe(PALETTE_B.toLowerCase());
    expect(screen.getByText('Project accent colour')).toBeVisible();

    // Selected for immediate overtyping (FR-026) — the half the E2E's `toHaveValue` could not see.
    await waitFor(() => {
      const nameInput = screen.getByTestId('project-name-input') as HTMLInputElement;
      expect(document.activeElement).toBe(nameInput);
      expect(nameInput.selectionStart).toBe(0);
      expect(nameInput.selectionEnd).toBe('AutoName'.length);
    });
  });

  it('refuses a duplicate or nested root on create AND on edit, keeping the form open and marked', async () => {
    /*
     * MIGRATED FROM `project-creation.e2e.ts:20`.
     *
     * The RULE (Principle I, FR-029) is not this component's — it belongs to `assertFolderExclusive`,
     * which `packages/core/tests/unit` owns and which the fake daemon here RUNS rather than imitates.
     * What is asserted is the form's answer to being refused: it stays open, it marks the field the
     * rejection names, and it accepts a non-overlapping root afterwards.
     */
    const { user, daemon } = await mount([], { picked: undefined });

    await createProject(user, 'Alpha', 'C:/code/alpha');

    // Identical root → refused.
    await user.click(screen.getByTestId('project-new'));
    await waitFor(() => expect(screen.getByTestId('project-form')).toBeVisible());
    await user.type(screen.getByTestId('project-root-input'), 'C:/code/alpha');
    await user.type(screen.getByTestId('project-name-input'), 'Beta');
    await user.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(projectError()).toBeVisible());
    expect(screen.getByTestId('project-form')).toBeVisible();
    expect(screen.getByTestId('project-root-input')).toHaveClass('project-form__field--error');
    // The NAME field is not blamed for a folder failure — the two classifications are disjoint.
    expect(screen.getByTestId('project-name-input')).not.toHaveClass('project-form__field--error');
    expect(daemon.names()).toEqual(['Alpha']);

    // A DESCENDANT root → still refused.
    const rootInput = screen.getByTestId('project-root-input');
    await user.clear(rootInput);
    await user.type(rootInput, 'C:/code/alpha/sub');
    await user.click(screen.getByTestId('project-save'));
    await waitFor(() => expect(projectError()).toBeVisible());
    expect(screen.getByTestId('project-form')).toBeVisible();
    expect(daemon.names()).toEqual(['Alpha']);

    // A non-overlapping root → accepted, and the form closes.
    await user.clear(rootInput);
    await user.type(rootInput, 'C:/code/beta');
    await user.click(screen.getByTestId('project-save'));
    await waitFor(() => expect(screen.queryByTestId('project-form')).toBeNull());
    expect(daemon.names()).toEqual(['Alpha', 'Beta']);

    // Editing Beta to overlap Alpha is refused by the same rule, through the OTHER command.
    await user.click(screen.getByTestId(`project-edit-${projectIdOf('Beta')}`));
    await waitFor(() => expect(screen.getByTestId('project-form')).toBeVisible());
    const editRoot = screen.getByTestId('project-root-input');
    await user.clear(editRoot);
    await user.type(editRoot, 'C:/code/alpha');
    await user.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(projectError()).toBeVisible());
    expect(screen.getByTestId('project-form')).toBeVisible();
    expect(screen.getByTestId('project-root-input')).toHaveClass('project-form__field--error');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * project-counts.e2e.ts
 * ────────────────────────────────────────────────────────────────────────── */

describe('the tab/panel counts beside each project (projects-panel.tsx:455)', () => {
  it('counts the OPEN project from its live layout, as tabs and panels are added', async () => {
    // MIGRATED FROM `project-counts.e2e.ts:12`.
    const { user } = await mount([], { picked: undefined });

    await createProject(user, 'Live', 'C:/c/live');
    await waitFor(() => expect(countsOf('Live')).toHaveTextContent('(1T·1P)'));

    await user.click(screen.getByTestId('add-tab'));
    await waitFor(() => expect(countsOf('Live')).toHaveTextContent('(2T·2P)'));

    await user.click(screen.getByTestId('add-panel'));
    await waitFor(() => expect(countsOf('Live')).toHaveTextContent('(2T·3P)'));
  });

  it('counts a CLOSED project from what the daemon actually persisted for it', async () => {
    /*
     * MIGRATED FROM `project-counts.e2e.ts:30`, whose `waitForTimeout(900)` was waiting for the
     * layout autosave. That sleep is replaced by waiting for the SAVE ITSELF to arrive at the fake
     * daemon, which keeps the claim the sleep stood in for: the debounced write really happened, and
     * the number rendered afterwards came out of it rather than out of a fixture.
     */
    const { user, daemon } = await mount([], { picked: undefined });

    await createProject(user, 'Alpha', 'C:/c/alpha');
    const alphaId = projectIdOf('Alpha');
    await user.click(screen.getByTestId('add-tab'));
    await waitFor(() => expect(countsOf('Alpha')).toHaveTextContent('(2T·2P)'));

    // The autosave, observed rather than slept through.
    await waitFor(
      () => expect(daemon.layoutOf(alphaId)?.tabs).toHaveLength(2),
      { timeout: 4000 },
    );

    // Creating Beta switches away from Alpha; Alpha's chip must now come from `projects.list`.
    await createProject(user, 'Beta', 'C:/c/beta');
    await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent(/^loaded:/));

    await waitFor(() => expect(countsOf('Alpha')).toHaveTextContent('(2T·2P)'));
    await waitFor(() => expect(countsOf('Beta')).toHaveTextContent('(1T·1P)'));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * project-rename-guard.e2e.ts
 * ────────────────────────────────────────────────────────────────────────── */

describe('the inline rename box (FR-029, 120-character cap)', () => {
  it('will not let you TYPE past 120 characters', async () => {
    /*
     * MIGRATED FROM `project-rename-guard.e2e.ts:19`.
     *
     * Checked against `packages/ui/tests/component/name-limit-field.test.ts` and NOT covered by it:
     * that file exercises `NameLimitField`, the TAB and PANEL rename box, whose limit comes from
     * `settings.tabs.maxNameLength`. The project box is a plain `<input maxLength={120}>` at
     * `projects-panel.tsx:474`, a different component with a different limit source.
     *
     * The attribute is asserted as well as the typed result, and deliberately: at this layer the
     * cap is enforced by user-event's emulation of `maxlength` rather than by a real browser, so the
     * attribute is the fact and the typed length is the corroboration.
     */
    const { user } = await mount([dto('p1', 'Proj', PALETTE_A, 'C:/code/proj')]);

    await user.dblClick(screen.getByTestId('project-switch-p1'));
    const input = (await screen.findByTestId('project-rename-input-p1')) as HTMLInputElement;
    expect(input).toHaveAttribute('maxlength', '120');

    await user.clear(input);
    await user.type(input, 'x'.repeat(130));
    expect(input.value.length).toBe(120);
  });

  it('keeps the editor OPEN, with the text intact, when the rename is refused', async () => {
    /*
     * MIGRATED FROM `project-rename-guard.e2e.ts:37`.
     *
     * The over-long value is written straight onto the element, as the E2E did, because that is the
     * paste path — `maxlength` bounds typing, not assignment. The rejection comes from the real
     * `validateProjectInput`, so the sentence the panel classifies is the shipped one.
     */
    const { user } = await mount([dto('p1', 'Proj', PALETTE_A, 'C:/code/proj')]);

    await user.dblClick(screen.getByTestId('project-switch-p1'));
    const input = (await screen.findByTestId('project-rename-input-p1')) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'y'.repeat(130) } });
    expect(input.value.length).toBe(130);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(projectError()).toBeVisible());
    const still = (await screen.findByTestId('project-rename-input-p1')) as HTMLInputElement;
    expect(still).toBeVisible();
    // Still there to be trimmed down — a closed editor would have thrown the user's text away.
    expect(still.value.length).toBe(130);
    /*
     * …and the row is still called what it was called — asserted AFTER cancelling, because while the
     * editor is open the row does not render its name at all: the input replaces it, so the row's
     * `textContent` is the icon strip ("⠿✎✕") and an assertion against it can only ever fail. The
     * first version of this test asked the open row for the old name and got exactly that.
     *
     * Escape closes the editor without committing (`projects-panel.tsx:482`), so what the row shows
     * afterwards IS the persisted name. That is the claim the E2E was making, observed where it
     * actually lives rather than where the draft was.
     */
    fireEvent.keyDown(still, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('project-rename-input-p1')).toBeNull());
    expect(screen.getByTestId('project-item-p1').textContent ?? '').toContain('Proj');
  });
});
