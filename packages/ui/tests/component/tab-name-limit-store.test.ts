import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { settleLayoutSaves } from '../../src/renderer/state/layout-saves.js';

/**
 * What the name limit does to what is STORED (031 US4, NP1–NP4, FR-035f, FR-039/FR-040, C5).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (035 T055/T056) — five declarations:
 *
 * | was | what it claimed |
 * |---|---|
 * | `:265` T081 | committing a rename applies the limit, so an over-long name cannot be reintroduced |
 * | `:329` T082 | lowering the limit mid-rename updates the counter immediately (C5) |
 * | `:355` T083 | a persisted layout holding a 300-character name loads, shortened and marked (NP4) |
 * | `:447` T084a | lower then raise with nothing else changed, and the full names return (NP1, NP3) |
 * | `:509` T084b | an ordinary layout save at the lower limit makes the shortening permanent (NP2) |
 *
 * ══ WHY THIS IS THE RIGHT LAYER, WHEN THE E2E'S OWN HEADER SAYS OTHERWISE ══
 *
 * That header says these four persistence tests "relaunch or write a layout" and stay untouched, and
 * for T083 that was literally true — it seeded SQLite before launch. But the claim underneath every
 * one of them is about **two seams in the renderer**, and neither is a window, a process or a
 * paint:
 *
 *  - `boundLayoutNames` reaching BOTH save paths in `workspace-store.tsx` — `flushSave` (the drain)
 *    and `scheduleSave` (the 400 ms debounce), through `boundForSave`; and
 *  - the limit being read LIVE from settings at the moment of the write, which is why it is held in
 *    a ref rather than closed over.
 *
 * `boundLayoutNames` itself is pure and covered by `core/tests/unit/bound-layout-names.test.ts`,
 * down to the reversibility and idempotence cases. **What had no test at any layer was the WIRING**
 * — that the pure function is on the write path at all, on both of them, and with the current limit
 * rather than the one that was live when the provider mounted. That is this spec's recurring
 * finding: both halves proven, the seam between them not.
 *
 * ══ THE SETTINGS CHANGE IS REAL HOT-RELOAD, NOT A RE-RENDER WITH DIFFERENT PROPS ══
 *
 * The E2E writes `settings.json` and waits for the watcher. Here `ConfigProvider` is mounted for
 * real and driven through `window.throng.config.onChange` — the exact callback the main process
 * broadcasts a reloaded document on. So the path under test is still "a setting changed underneath a
 * live window"; only the filesystem round trip in front of it is gone, and that round trip is
 * covered by `integration/config-store.integration.test.ts` and `integration/prefs-external-change.test.ts`.
 *
 * ══ WHAT STAYS IN THE E2E ══
 *
 * `T078`, which compares the counter's COMPUTED colour and font-weight against a sibling under a
 * real inherited cascade (034 FR-049). jsdom computes no cascade, so that one is `@reserve:layout`
 * and is not reachable from here.
 */

const PROJECT = 'proj-limit';

/**
 * A deterministic name of `n` characters whose every prefix differs from every other prefix, so
 * "shortened to 30" and "shortened to 16" can never be confused for one another — and so a
 * substring match cannot be satisfied by a longer run of the same character.
 *
 * Carried over from the migrated spec, which had the same reason for it.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const name = (n: number): string =>
  Array.from({ length: n }, (_, i) => ALPHABET[i % ALPHABET.length]).join('');

/* ────────────────────────────────────────────────────────────────────────── *
 * The fake daemon — every `workspace.save` is kept, in order
 * ────────────────────────────────────────────────────────────────────────── */

function fakeDaemon(initial: WorkspaceLayout) {
  const saved: WorkspaceLayout[] = [];
  /*
   * STATEFUL, and that is the point. NP1 and NP2 are both claims about what a later LOAD returns,
   * so a daemon that answered `load` from a fixture would make either of them unfalsifiable: the
   * stored name could be rewritten by every save and the reload would still hand back the original.
   * Here a save replaces what the next load serves, exactly as the repository does.
   */
  const store = new Map<string, WorkspaceLayout>([[initial.projectId, initial]]);
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load': {
          const id = (params as { projectId: string }).projectId;
          // `restored: true` matters: a layout the repository SYNTHESISED is written back
          // immediately (`workspace-store.tsx:261`), and that write would make "loading issues no
          // save" vacuously false for a reason that has nothing to do with the limit.
          const held = store.get(id);
          if (held) return Promise.resolve({ layout: held, restored: true } as T);
          const fresh = createDefaultLayout(id, { tab: `t-${id}`, panel: `p-${id}` });
          store.set(id, fresh);
          return Promise.resolve({ layout: fresh, restored: true } as T);
        }
        case 'workspace.save': {
          const layout = (params as { layout: WorkspaceLayout }).layout;
          saved.push(layout);
          store.set((params as { projectId: string }).projectId, layout);
          return Promise.resolve({ ok: true } as T);
        }
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'panelName.claim':
          return Promise.resolve({
            granted: (params as { desired: string }).desired,
            adjusted: false,
          } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the tab strip: ${method}`));
      }
    },
  };
  return { bridge, saved };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

/** Settings as the config payload carries them — a whole document, because main sends a whole one. */
const withLimit = (limit: number): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  tabs: { ...DEFAULT_APP_SETTINGS.tabs, maxNameLength: limit },
});

/** The live broadcast handlers `ConfigProvider` registered, so a test can be the main process. */
const listeners: ((payload: unknown) => void)[] = [];

function mount(opts: { limit: number; title?: string }) {
  const user = userEvent.setup();
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  if (opts.title !== undefined) layout.tabs[0].title = opts.title;

  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
    config: {
      get: () => Promise.resolve({ settings: withLimit(opts.limit) }),
      onChange: (fn: (payload: unknown) => void) => {
        listeners.push(fn);
        return () => {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        };
      },
    },
  });

  const daemon = fakeDaemon(layout);
  const services = servicesOver(daemon.bridge);

  const tree = (activeProjectId: string) =>
    createElement(
      ConfigProvider,
      null,
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId },
            createElement(
              NotificationProvider,
              null,
              createElement(
                ConfirmProvider,
                null,
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Fragment, null, createElement(TabGroup, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    );

  const { rerender } = render(tree(PROJECT));

  /**
   * Switch away and back — a REAL reload, which is the whole reason the migrated test did it.
   *
   * The renderer's in-memory layout keeps the full title whatever the display does, so a raised
   * limit that restored the name from memory would look identical to one that restored it from the
   * store. Only a load can tell those apart.
   */
  const reload = async (): Promise<void> => {
    await act(async () => {
      rerender(tree('proj-elsewhere'));
    });
    await waitFor(() => expect(document.querySelectorAll('.tab-chip').length).toBeGreaterThan(0));
    await act(async () => {
      rerender(tree(PROJECT));
    });
  };

  return { user, daemon, reload };
}

/** Be the main process: a reloaded settings document reaches every live window this way. */
async function broadcastLimit(limit: number): Promise<void> {
  await act(async () => {
    for (const fn of [...listeners]) fn({ settings: withLimit(limit) });
  });
}

/** The strip, once it has drawn its first chip — and the id of that chip. */
async function ready(): Promise<string> {
  await screen.findByTestId('tab-strip');
  const chip = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.tab-chip');
    if (!el) throw new Error('no chip yet');
    return el;
  });
  return (chip.getAttribute('data-testid') ?? '').replace(/^tab-/, '');
}

const label = (tab: string): HTMLElement => screen.getByTestId(`tab-title-${tab}`);

/**
 * Drain the store's write queue and let the fake daemon's promise settle.
 *
 * `settleLayoutSaves` is the window's real shutdown drain (019 FR-010) — the same door the close
 * path uses — so this exercises `flushSave` rather than sleeping past the 400 ms debounce and hoping.
 */
async function drain(): Promise<void> {
  await act(async () => {
    await settleLayoutSaves();
  });
}

/** What the last save carried as the first tab's title — `undefined` if nothing was saved. */
const lastSavedTitle = (saved: WorkspaceLayout[]): string | undefined =>
  saved.length ? saved[saved.length - 1].tabs[0].title : undefined;

beforeEach(() => {
  listeners.length = 0;
  localStorage.clear();
});
afterEach(() => {
  listeners.length = 0;
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * NP4 — a stored name longer than anything the interface can produce
 * ────────────────────────────────────────────────────────────────────────── */

describe('a layout holding an over-long name loads (NP4, FR-038, migrated from :355)', () => {
  it('renders it cut to the limit and marks it as cut', async () => {
    /*
     * 300 characters cannot be produced through the interface at all — the setting's own ceiling is
     * 128 — so the only source is a layout written by an older build or by something else. The E2E
     * had to seed SQLite before launch to say this; the same claim is one field on the layout the
     * load returns.
     */
    mount({ limit: 30, title: name(300) });
    const tab = await ready();

    await waitFor(() => expect(label(tab)).toHaveTextContent(name(30)));
    expect(label(tab).textContent, 'cut to the limit, not merely shortened somewhere').toBe(name(30));
    expect(label(tab).className, 'FR-037c: and marked as cut').toContain('tab-chip__label--truncated');
  });

  it('does NOT write the shortened name back merely for having read it (NP1, NP3)', async () => {
    /*
     * The half that makes lowering the limit reversible. A load is a read, and a read is not a
     * reason to rewrite: if it were, the other 270 characters would be gone the first time the app
     * opened the project at a low limit, and no later raise could bring them back.
     */
    const { daemon } = mount({ limit: 30, title: name(300) });
    await ready();
    await drain();

    expect(daemon.saved, 'a restored layout is loaded, not re-saved').toHaveLength(0);
  });

  it('is not marked when the stored name already fits', async () => {
    // Without this, a chip that marked EVERY name would pass the assertion above perfectly.
    mount({ limit: 30, title: name(12) });
    const tab = await ready();

    await waitFor(() => expect(label(tab).textContent).toBe(name(12)));
    expect(label(tab).className).not.toContain('tab-chip__label--truncated');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * NP1/NP3 — lower, then raise, with nothing else changed
 * ────────────────────────────────────────────────────────────────────────── */

describe('lowering the limit is reversible while nothing else is written (NP1, NP3, migrated from :447)', () => {
  it('shortens the display when the limit drops under a live window (FR-039)', async () => {
    const { daemon } = mount({ limit: 64, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await broadcastLimit(16);

    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));
    expect(label(tab).className).toContain('tab-chip__label--truncated');
    expect(daemon.saved, 'a limit change is not a layout change').toHaveLength(0);
  });

  it('survives a RELOAD at the low limit with the stored name intact (NP3)', async () => {
    /*
     * NP3 — loading a layout at the low limit is still not a reason to write it. This is the case
     * the display assertion above cannot reach: the renderer holds the full title in memory either
     * way, so only a round trip through the store can tell "read it and left it" from "read it and
     * rewrote it".
     */
    const { daemon, reload } = mount({ limit: 64, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await broadcastLimit(16);
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));
    await reload();

    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));
    expect(
      JSON.stringify(daemon.saved).includes(name(64)),
      'NP1/NP3: neither reading nor loading may rewrite the stored name',
    ).toBe(false);
    expect(daemon.saved, 'and in fact nothing was written at all').toHaveLength(0);
  });

  it('brings the full name back when the limit is raised again', async () => {
    /*
     * The claim NP1 exists for. The limit was applied at READ time before 031 fixed it, and that
     * shape is the one this catches: bound what the store hands back and the full name is gone from
     * the running application the first time it is opened at a low limit — after which no raise can
     * return it, because there is nothing left to return.
     *
     * The reload is what makes it falsifiable. Without one the value never leaves memory, and a
     * read-time bound is never reached.
     */
    const { reload } = mount({ limit: 64, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await broadcastLimit(16);
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));
    await reload();
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));

    await broadcastLimit(64);

    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));
    expect(label(tab).className, 'nothing is cut any more, so nothing is marked').not.toContain(
      'tab-chip__label--truncated',
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * NP2 — the deliberately lossy half
 * ────────────────────────────────────────────────────────────────────────── */

describe('an ordinary save at the lower limit makes it permanent (NP2, FR-040, migrated from :509)', () => {
  it('carries the SHORTENED name on a save made for some other reason', async () => {
    /*
     * Adding a tab is a layout change that is not about this tab's name at all, which is exactly
     * what NP2 is about: the shortened form rides along on the next write that was going to happen
     * anyway. Asserted on what reached `workspace.save`, because that is the boundary the rule is
     * stated at.
     */
    const { user, daemon, reload } = mount({ limit: 64, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await broadcastLimit(16);
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));

    await user.click(screen.getByTestId('tab-add'));
    await drain();

    expect(daemon.saved.length, 'the unrelated change was written').toBeGreaterThan(0);
    expect(lastSavedTitle(daemon.saved), 'NP2: the save carried the bounded name').toBe(name(16));

    /*
     * And it is PERMANENT, which is the half that makes FR-040 a two-part rule. Raising the limit
     * cannot bring back what is no longer stored — so the reload after the raise still reads 16.
     */
    await broadcastLimit(64);
    await reload();
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));
  });

  it('binds the DEBOUNCED save path too, not only the drain', async () => {
    /*
     * `boundForSave` is threaded through two callbacks — `flushSave` and `scheduleSave` — and the
     * test above reaches the first, because `settleLayoutSaves` fires the armed timer through the
     * flusher. A debounce left to expire on its own is the other path, and dropping the bound from
     * it alone would leave every assertion above green.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
      layout.tabs[0].title = name(64);
      Reflect.set(window, 'throng', {
        panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
        config: {
          get: () => Promise.resolve({ settings: withLimit(64) }),
          onChange: (fn: (payload: unknown) => void) => {
            listeners.push(fn);
            return () => {};
          },
        },
      });
      const daemon = fakeDaemon(layout);
      const services = servicesOver(daemon.bridge);
      render(
        createElement(
          ConfigProvider,
          null,
          createElement(
            ServicesProvider,
            { services },
            createElement(
              ProjectsProvider,
              { client: services.projects },
              createElement(
                WorkspaceProvider,
                { client: services.workspace, activeProjectId: PROJECT },
                createElement(
                  NotificationProvider,
                  null,
                  createElement(
                    ConfirmProvider,
                    null,
                    createElement(
                      ContextMenuProvider,
                      null,
                      createElement(TabGroup, null),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      const tab = await ready();
      await waitFor(() => expect(label(tab).textContent).toBe(name(64)));
      await broadcastLimit(16);
      await waitFor(() => expect(label(tab).textContent).toBe(name(16)));

      await user.click(screen.getByTestId('tab-add'));
      // Past the 400 ms debounce, without draining — so the timer, not the flusher, does the write.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(daemon.saved.length, 'the debounce fired').toBeGreaterThan(0);
      expect(lastSavedTitle(daemon.saved), 'the debounced write is bounded too').toBe(name(16));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the CURRENT limit at the moment of the write, not the one live at mount', async () => {
    /*
     * Why `maxNameLength` is a ref. `flushSave` and `scheduleSave` are memoised on `client`, so a
     * limit closed over would be the mount-time value for the whole life of the provider — and
     * every test above would still pass, because they all start at 64 and the assertion they make
     * is about what happens AFTER the drop. This one starts at 16 and RAISES to 64, so a frozen
     * limit cuts a name it should have let through.
     */
    const { user, daemon } = mount({ limit: 16, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(16)));

    await broadcastLimit(64);
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await user.click(screen.getByTestId('tab-add'));
    await drain();

    expect(lastSavedTitle(daemon.saved), 'bounded at 64, the limit live NOW').toBe(name(64));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * C5 and FR-035f — the box, while the limit moves under it
 * ────────────────────────────────────────────────────────────────────────── */

describe('the open rename box follows the limit (C5, migrated from :329)', () => {
  it('re-counts against the new limit while the box is open', async () => {
    /*
     * The preferences window is a separate window and settings hot-reload, so the limit really can
     * change while this box is on screen. The counter is the observable because it names BOTH
     * numbers — used and total — so "30/30" cannot be produced by a field that merely truncated.
     */
    const { user } = mount({ limit: 64, title: 'Live' });
    const tab = await ready();

    await user.dblClick(screen.getByTestId(`tab-${tab}`));
    const input = (await screen.findByTestId(`tab-rename-input-${tab}`)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, name(60));
    await waitFor(() =>
      expect(screen.getByTestId(`tabstrip-rename-count-${tab}`).textContent).toBe('60/64'),
    );

    await broadcastLimit(30);

    await waitFor(() =>
      expect(screen.getByTestId(`tabstrip-rename-count-${tab}`).textContent).toBe('30/30'),
    );
    expect(input.value, 'and the text in the box was cut to it').toBe(name(30));
  });

  it('cannot be used to put an over-long name back (FR-035f, migrated from :265)', async () => {
    /*
     * The half that protects the DATA. The stored name is over-long for the limit now in force;
     * a rename made in that state must not be a route back to it, however much text is offered.
     *
     * Asserted on what reached `workspace.save` rather than on the chip: a label shows the bounded
     * form whatever the store holds, so a chip reading 30 characters proves nothing about the
     * write. This is the assertion the E2E made against SQLite, and it is the same assertion.
     */
    const { user, daemon } = mount({ limit: 64, title: name(64) });
    const tab = await ready();
    await waitFor(() => expect(label(tab).textContent).toBe(name(64)));

    await broadcastLimit(30);
    await waitFor(() => expect(label(tab).textContent).toBe(name(30)));

    await user.dblClick(screen.getByTestId(`tab-${tab}`));
    const input = (await screen.findByTestId(`tab-rename-input-${tab}`)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'zz' + name(40));
    expect(input.value, 'the field cut the new text at the limit').toBe(('zz' + name(40)).slice(0, 30));
    await user.keyboard('{Enter}');
    await drain();

    expect(lastSavedTitle(daemon.saved), 'the commit applied the limit to what was typed').toBe(
      ('zz' + name(40)).slice(0, 30),
    );
    expect(
      JSON.stringify(daemon.saved).includes(name(64)),
      'FR-035f: the rename could not reintroduce the over-long name',
    ).toBe(false);
  });
});
