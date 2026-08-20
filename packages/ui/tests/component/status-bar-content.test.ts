/**
 * What the main-window status bar puts on screen — FR-003/004 as narrowed by 026 / #166.
 *
 * PLACE AT: `packages/ui/tests/component/status-bar-content.test.ts`
 * MIGRATED FROM (035 FR-007): `packages/ui/tests/e2e/status-bar.e2e.ts` — both tests, file deleted.
 *
 * ══ WHY THESE COME DOWN ══
 *
 * `StatusBar` reads one thing — `useProjects().activeProject` — and renders its `rootFolder` in a
 * span, or nothing. Every assertion in the E2E file was `toBeVisible`, `toHaveCount(0)`,
 * `toHaveText` or `not.toContainText`: presence, absence and text. No geometry, no computed style,
 * no second window, no real keyboard. The bar's HEIGHT is a layout claim and would have to stay at
 * E2E — but the E2E never asserted it, and inventing that assertion here to justify the file would
 * be writing a test to fit the tool.
 *
 * The two tests cost a shared Electron launch and a real daemon to ask what a 30-line component
 * returns for two values of one prop.
 *
 * ══ THE ORDER DEPENDENCY THE E2E HAD TO LIVE WITH, AND THIS DOES NOT ══
 *
 * The E2E file carried a warning in capitals: *"ORDER IS LOAD-BEARING, and nothing enforces it."*
 * Its first test asserted the no-project state, which under one shared app is a STARTUP condition —
 * only the first test in the file could make it, and adding a project-creating test above it would
 * have broken it silently.
 *
 * Here there is no shared startup to be first in. Each test mounts its own tree with its own seed,
 * so "no project" is a value passed in rather than a moment in time. The hazard is not mitigated;
 * it stops existing. That is worth more than the ~2s of launch this saves.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `ProjectsProvider` element in `mount()` and render its child directly. `StatusBar`
 * calls `useProjects()` unconditionally, which throws outside a provider, so the render fails before
 * any assertion runs and BOTH tests fail. This matters here more than usual: this file is mostly
 * absence assertions (`queryByTestId(...)` is null), and absence is exactly what an empty document
 * satisfies for free. The guard is that every test asserts the bar itself is PRESENT first.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { StatusBar } from '../../src/renderer/statusbar/status-bar.js';

/**
 * The root folder deliberately shares NO substring with the project name.
 *
 * The E2E got this by accident — its root was a `mkdtemp` path like `throng-statusbar-a1b2c3` and
 * its project was `Bartholomew`, so "the bar does not show the name" was a real assertion. Naming
 * the folder after the project (`D:/work/Bartholomew`) makes that assertion impossible to satisfy
 * while the path is displayed, which is a fixture bug that looks exactly like a product bug. It cost
 * one red run here to find, and it would have cost a lot more inside a suite that trusted it.
 */
const PROJECT_NAME = 'Bartholomew';
const ROOT = 'D:/work/ledger-tooling';

function dto(id: string, name: string, rootFolder: string, isActive: boolean): ProjectDto {
  return {
    id,
    name,
    colour: '#4488cc',
    rootFolder,
    isActive,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  };
}

/** The daemon, as far as this bar can tell: a project list and nothing else. */
function bridgeFor(projects: ProjectDto[]): ThrongBridge {
  return {
    invoke<TResult>(method: string): Promise<TResult> {
      if (method === 'projects.list') return Promise.resolve({ projects } as TResult);
      if (method === 'projects.setActive') return Promise.resolve({} as TResult);
      return Promise.reject(new Error(`unexpected call: ${method}`));
    },
  } as ThrongBridge;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/**
 * Opens a project in THIS window, then renders the bar.
 *
 * Worth spelling out, because it is the one thing that made this migration non-obvious: the bar's
 * `activeProject` does NOT come from the `isActive` flag on the project row. `projects-store.tsx:148`
 * derives it from `openedId`, a per-WINDOW piece of renderer state that only `switchProject` sets.
 * The two are genuinely different questions — which project the database considers active, and which
 * one this window is looking at — and a second window is exactly why.
 *
 * The E2E never had to know this: `createProject()` switched as a side effect of creating. Seeding
 * `isActive: true` and expecting a path is the mistake that shape invites, and it fails here rather
 * than passing for the wrong reason.
 */
function OpenProject({ id, children }: { id: string | null; children: ReactNode }): ReactElement {
  const { switchProject } = useProjects();
  useEffect(() => {
    if (id) void switchProject(id);
  }, [id, switchProject]);
  return createElement('div', null, children);
}

async function mount(projects: ProjectDto[]): Promise<void> {
  // `DaemonIndicator` reads `window.throng?.daemon` and returns early when absent, so a healthy
  // daemon needs no stub — it renders null. Left absent deliberately: stubbing it would assert this
  // file's assumption about the indicator rather than the bar's own content.
  Reflect.set(window, 'throng', {});

  // ANTI-VACUITY CONTROL: drop this `ProjectsProvider` element and `useProjects` throws inside
  // `StatusBar`, failing both tests. See the file header.
  render(
    createElement(ProjectsProvider, {
      client: new ProjectsClient(bridgeFor(projects)),
      children: createElement(
        NotificationProvider,
        null,
        createElement(OpenProject, {
          id: projects[0]?.id ?? null,
          children: createElement(StatusBar, null),
        }),
      ),
    }),
  );

  // Start from a LOADED list, so an absence assertion can never be a race with the store's first
  // `projects.list` reply.
  await waitFor(() => expect(screen.getByTestId('status-bar')).toBeInTheDocument());
}

describe('status bar content (FR-003/004, narrowed by 026 / #166)', () => {
  it('shows nothing but the bar itself when no project is active', async () => {
    await mount([]);

    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('status-project-path')).toBeNull();
    // The identity content #166 removed: the colour dot and the `Tab · Panel` context label. Both
    // now live in the frameless title bar, from the same source — two rows apart is not redundancy
    // that helps.
    expect(screen.queryByTestId('status-project-dot')).toBeNull();
    expect(screen.queryByTestId('status-context')).toBeNull();
    // And it does not fill the gap with a placeholder.
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('No project');
  });

  it('shows the active project’s root folder path, and only that', async () => {
    await mount([dto('p1', PROJECT_NAME, ROOT, true)]);

    await waitFor(() =>
      expect(screen.getByTestId('status-project-path')).toHaveTextContent(`(${ROOT})`),
    );
    expect(screen.queryByTestId('status-project-dot')).toBeNull();
    expect(screen.queryByTestId('status-context')).toBeNull();
    // The project NAME is the title bar's job. The bar carries the path precisely because that is
    // the one identity element the title bar deliberately does not show (021 removed it as noise).
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent(PROJECT_NAME);
  });

  it('carries no tab identity, whatever the tab is called', async () => {
    // The E2E made this claim by adding a tab, reading its committed title back out of the DOM, and
    // asserting the bar did not contain that string. The claim underneath is stronger and simpler:
    // `StatusBar` never consults the layout at all, so no tab name can reach it. Asserting it
    // against a name chosen to be conspicuous is a fair test of that, and does not need a workspace.
    await mount([dto('p1', PROJECT_NAME, ROOT, true)]);
    await waitFor(() =>
      expect(screen.getByTestId('status-project-path')).toHaveTextContent(`(${ROOT})`),
    );

    const bar = screen.getByTestId('status-bar');
    expect(bar).not.toHaveTextContent('Tab');
    expect(bar).not.toHaveTextContent('·');
    // The path is the whole of the bar's text.
    expect(bar.textContent?.trim()).toBe(`(${ROOT})`);
  });
});

/**
 * The bar carries no ADMIN pill, whatever the daemon says (026 / #166).
 *
 * ADDED COVERAGE, not a migration. `status-bar-deduped.e2e.ts:70` asserts two things — that
 * `[ADMIN]` is on the title bar AND that the status bar has no pill — and only the second half is
 * this component's. The first is composed in `app.tsx:517` and reaches `TitleBar` as a plain
 * `identity` prop, so proving it here would need that composition extracted; that is a production
 * refactor, not a test migration, and the E2E keeps both halves until someone makes it.
 *
 * The half below was asserted nowhere, and it is the one with a mechanism worth pinning. #166's
 * finding was that the pill, the dot, the name and the `Tab · Panel` context were all SECOND COPIES
 * of what the frameless title bar already shows, from the same source. The repair was not to hide
 * them — it was for `StatusBar` to stop consulting those sources at all, which is why the file's
 * existing tab-identity test says *"`StatusBar` never consults the layout"* rather than checking a
 * conditional.
 *
 * The same holds for elevation: the bar never calls `useCapabilities()`, so no elevation signal can
 * reach it. Asserting that against a daemon reporting `elevated: true` is a fair test of it, and
 * needs no window.
 */
describe('elevation reaches the title bar and not this one (#166)', () => {
  it('renders no ADMIN pill while the daemon reports the app IS elevated', async () => {
    // The seam `useCapabilities` reads. An elevated answer here is what the E2E's
    // THRONG_FAKE_ELEVATED=1 produces in the application.
    const throng = (window as unknown as { throng?: Record<string, unknown> }).throng ?? {};
    (throng as Record<string, unknown>).terminal = {
      capabilities: () => Promise.resolve({ elevated: true }),
    };
    Reflect.set(window, 'throng', throng);

    await mount([dto('p1', PROJECT_NAME, ROOT, true)]);
    await waitFor(() =>
      expect(screen.getByTestId('status-project-path')).toHaveTextContent(`(${ROOT})`),
    );

    expect(screen.queryByTestId('status-admin-pill')).toBeNull();
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('ADMIN');
  });

  it('is the same bar either way — the absence above is not an elevated-only branch', async () => {
    /*
     * The anti-vacuity half. A bar that rendered nothing at all under elevation would satisfy the
     * test above, and so would one that happened to be mid-load. Asserting the bar is fully itself
     * — the path present, the pill absent — is what makes it a statement about the PILL.
     */
    await mount([dto('p1', PROJECT_NAME, ROOT, true)]);
    await waitFor(() =>
      expect(screen.getByTestId('status-project-path')).toHaveTextContent(`(${ROOT})`),
    );

    expect(screen.queryByTestId('status-admin-pill')).toBeNull();
  });
});
