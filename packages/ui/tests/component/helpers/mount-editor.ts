import { render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createElement, Fragment, type ReactElement } from 'react';
import { vi } from 'vitest';
import { createDefaultLayout, type AppSettings, type Panel, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../../src/renderer/state/projects-store.js';
import {
  ConfigProvider,
  useAppSettings,
  useConfigLoaded,
} from '../../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { EditorPanel } from '../../../src/renderer/editor/editor-panel.js';
import { getEditorActions } from '../../../src/renderer/editor/editor-actions.js';
import { EditorNoticeDialog } from '../../../src/renderer/editor/editor-notice-dialog.js';
import { MissingFileWatcher } from '../../../src/renderer/editor/missing-file-watcher.js';

/**
 * Mount a REAL CodeMirror editor panel in jsdom, behind a fake `editor.*` bridge.
 *
 * ══ WHY THIS EXISTS, AND WHY IT WAS BELIEVED IMPOSSIBLE ══
 *
 * Nothing in this suite had ever constructed an `EditorView` with a DOM parent — the closest,
 * `component/editor-command-semantics.test.ts`, drives commands against a `FakeView` and says so.
 * That made "the editor cannot be mounted below E2E" an assumption nobody had tested, and it is
 * false: `new EditorView({ parent })` mounts in jsdom, renders `.cm-content`, and handles keydown
 * through its own keymap. Measured before this helper was written, with a throwaway spike.
 *
 * What jsdom still cannot do is LAYOUT — every rect is 0×0, so anything about wrapped line heights,
 * the viewport, or a computed cascade stays at E2E under `@reserve:layout`. Everything about the
 * DOCUMENT and the decisions taken over it is reachable here.
 *
 * ══ THE BRIDGE IS A DOCUMENT AUTHORITY, NOT A BAG OF STUBS ══
 *
 * `useEditor` mounts by asking `getContent(panelId)` and adopting whatever comes back, then listens
 * on `onSync`. That is exactly how a real mirrored view or a moved panel adopts UI main's document,
 * so a fake that answers those two faithfully exercises the real mount path rather than a special
 * case. {@link EditorHarness.pushReset} is the other half: the message UI main broadcasts when the
 * document is REPLACED — a second file opened into the panel, a revert, an external reload.
 */

export interface EditorDoc {
  text: string;
  version: number;
  dirty?: boolean;
  absPath?: string | null;
  fileMissing?: boolean;
  unloadable?: boolean;
  encoding?: string;
  hasBom?: boolean;
  lineEnding?: string;
}

export interface EditorHarness {
  /** Broadcast a document REPLACEMENT, as UI main does when a different file is opened in place. */
  pushReset(doc: EditorDoc): void;
  /**
   * Open a DIFFERENT file into this panel, by the route a tree click takes.
   *
   * `getEditorActions(panelId).openFile` is that route: it calls `editor.load`, records the new
   * path, and re-derives the language from it before the replacement content arrives — which is the
   * ordering the source calls out as load-bearing (`use-editor.ts:600`). A test that only pushed a
   * reset would skip all of it and prove nothing about a second open.
   */
  openFile(doc: EditorDoc & { absPath: string }): Promise<void>;
  /**
   * Tell the view the file MOVED, as `markMoved` does (019 FR-002).
   *
   * Its path changed and nothing else did: no dirty flag, no reload, no notice. This is the
   * message, not a re-open, and the distinction is the whole of AC1.
   */
  pushMoved(absPath: string): void;
  /** Broadcast any other sync message the authority sends — `externalChange`, `dirty`, `wordWrap`. */
  pushSync(msg: Record<string, unknown>): void;
  /**
   * Broadcast a SETTINGS change, as main's config hot-reload watcher does (`throng:config`).
   *
   * The counterpart of {@link pushSync} for the other live channel. `opts.settings` seeds what the
   * editor mounts WITH; this is what happens after it has mounted — the half of every "takes effect
   * without reopening" requirement that a seed cannot show, because a value present at mount proves
   * only that the mount read it.
   *
   * The payload is the whole config document, exactly as `ConfigProvider` receives it: main
   * broadcasts the document, not a diff, and `guardedSettingsValidator` fills every key the caller
   * leaves out. Wrap the call in `act()` — it drives a React state update.
   */
  pushSettings(settings: Record<string, unknown>): void;
  /**
   * The settings the mounted tree is holding RIGHT NOW — not the ones `opts.settings` asked for.
   *
   * ══ THE TRAP THIS EXISTS TO CLOSE (issue #335) ══
   *
   * `opts.settings` is delivered through `config.get()`, which `ConfigProvider` awaits in an
   * effect. The document arrives on a DIFFERENT promise, through `editor.getContent()`. Waiting
   * for the document — the thing every test here mounts for — says nothing about whether the
   * settings have landed, so a test that waits for the text and then asserts on
   * settings-dependent behaviour is reading a tree still holding `DEFAULT_APP_SETTINGS`.
   *
   * It is invisible locally, because both promises are already resolved and the two effects
   * settle in the same handful of microtasks. On a loaded CI runner it is a coin toss: #335 was
   * `editor.autoSave` still reading its shipped default of `false`, so the auto-save timer the
   * test was counting had never been armed and the assertion saw an empty array.
   *
   * So a test whose subject is a setting waits on {@link settingsLoaded} — or, better, on the
   * observable that setting produces — before it asserts anything.
   */
  settings(): AppSettings;
  /** True once `config.get()`'s payload has been applied to the tree (see {@link settings}). */
  settingsLoaded(): boolean;
  /** Every message the renderer sent back through `editor.dispatch`. */
  readonly dispatched: unknown[];
  /** The live CodeMirror content element. */
  content(): HTMLElement;
  /** The live `EditorView` — the document as CodeMirror holds it, not as the DOM renders it. */
  view(): EditorView;
  /** The document as the view holds it. */
  text(): string;
  readonly calls: Record<string, ReturnType<typeof vi.fn>>;
}

const PROJECT = 'proj-editor';

/**
 * Resolve `value` `ticks` macrotasks from now — zero ticks resolves as a plain promise would.
 *
 * Macrotasks rather than microtasks on purpose: a chain of `await`s would still settle inside the
 * same task, so React could flush everything before any test code ran and the delay would prove
 * nothing. A `setTimeout(…, 0)` yields to the event loop, which is where the two channels of
 * issue #335 actually get reordered.
 */
function afterTicks<T>(ticks: number, value: T): Promise<T> {
  if (ticks <= 0) return Promise.resolve(value);
  return new Promise<T>((resolve) => {
    let left = ticks;
    const step = (): void => {
      if (left-- <= 0) {
        resolve(value);
        return;
      }
      setTimeout(step, 0);
    };
    step();
  });
}

export function mountEditor(opts: {
  panelId?: string;
  /** The document the panel adopts on mount — as `getContent` would answer for a live document. */
  doc: EditorDoc;
  /** Extra settings overrides, merged over the shipped defaults. */
  settings?: Record<string, unknown>;
  projectRoot?: string | null;
  /** A sub-workspace editor: no project root, and the opposite save boundary (FR-078). */
  rootless?: boolean;
  /**
   * Also mount `EditorNoticeDialog`, the adapter that turns an editor notice into a notification.
   *
   * Off by default: it is a second subject, and a test that does not assert on notices should not
   * have one rendering beside the editor.
   */
  withNotices?: boolean;
  /**
   * Also mount `MissingFileWatcher`, the once-per-tab-activation scan that raises the CONSOLIDATED
   * notice naming which panels an absent path defeated (030 FR-029/FR-034a/FR-035).
   *
   * Off by default, for the same reason as `withNotices`: it is a second subject. It is available
   * here — rather than in `component/missing-file-watcher.test.ts`, which drives the watcher against
   * a hand-written `editor-state` fixture — because the defect it is needed for is about WHEN this
   * panel's own mount publishes its load state, and a fixture that writes those flags by hand is
   * precisely what cannot express "the open has not answered yet".
   */
  withMissingFileWatcher?: boolean;
  /**
   * Hold `config.get()`'s answer back by this many macrotasks, so the settings channel provably
   * loses its race with the document channel (issue #335).
   *
   * Zero — the default — changes nothing: the promise resolves as it always did. Any positive
   * value turns a race that CI loses occasionally into one this machine loses every time, which
   * is what makes a settings-dependent assertion testable rather than merely lucky. A test that
   * waits on {@link EditorHarness.settingsLoaded} passes at any value; one that waits only for
   * the document text fails at 1.
   */
  configDelayTicks?: number;
}): EditorHarness {
  const panelId = opts.panelId ?? 'p-ed';
  const projectRoot = opts.projectRoot ?? 'C:/proj';

  let current: EditorDoc = { dirty: false, absPath: null, ...opts.doc };
  const listeners: ((msg: unknown) => void)[] = [];
  /** Subscribers to the config hot-reload channel — see {@link EditorHarness.pushSettings}. */
  const configListeners: ((payload: unknown) => void)[] = [];
  const dispatched: unknown[] = [];
  /** Files this harness will serve to a subsequent `openFile`, keyed by path. */
  const pendingOpens = new Map<string, EditorDoc>();
  const broadcastReset = (doc: EditorDoc): void => {
    for (const fn of [...listeners]) {
      fn({
        panelId,
        reset: {
          documentId: panelId,
          text: doc.text,
          version: doc.version,
          dirty: doc.dirty ?? false,
        },
      });
    }
  };
  const calls: Record<string, ReturnType<typeof vi.fn>> = {
    register: vi.fn(),
    destroy: vi.fn(),
    verifyPath: vi.fn(),
    save: vi.fn(() => Promise.resolve({ ok: true })),
    revert: vi.fn(),
    reload: vi.fn(() => Promise.resolve({ ok: true })),
    undo: vi.fn(),
    redo: vi.fn(),
  };

  /*
   * jsdom implements no text geometry, and CodeMirror's selection LAYER measures it on every
   * update — `textRange(...).getClientRects is not a function`, thrown inside a `measure` callback
   * it swallows. Harmless to every assertion here, and noisy enough to hide a real failure in the
   * scrollback, so the two methods it reaches for return empty. Nothing below asserts on geometry;
   * anything that needs to is `@reserve:layout` and stays at E2E.
   */
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }

  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
    config: {
      get: () =>
        afterTicks(
          opts.configDelayTicks ?? 0,
          opts.settings ? { settings: opts.settings } : { settings: undefined },
        ),
      /*
       * A REAL subscription, not a stub that returns an unsubscribe and forgets the callback.
       *
       * The version this replaced — `onChange: () => () => {}` — stored nothing, so no settings
       * change could ever be pushed to a mounted editor and every "this takes effect live"
       * requirement was unprovable below E2E. It looked complete, which is why it survived: the
       * signature is right and the unsubscribe works.
       */
      onChange: (fn: (payload: unknown) => void) => {
        configListeners.push(fn);
        return () => {
          const at = configListeners.indexOf(fn);
          if (at >= 0) configListeners.splice(at, 1);
        };
      },
    },
    editor: {
      ...calls,
      /*
       * The coordinator's contract in miniature: a load REPLACES the document and broadcasts the
       * replacement to every view of it. The renderer's `openFile` awaits this answer, records the
       * new path from it, and re-derives the language BEFORE the reset lands — so the broadcast has
       * to happen inside the same call, not be left to the test to fire afterwards.
       */
      load: (req: { absPath: string }) => {
        const next = pendingOpens.get(req.absPath);
        if (!next) return Promise.resolve({ ok: false as const, reason: 'io' });
        current = { dirty: false, ...next };
        queueMicrotask(() => broadcastReset(next));
        return Promise.resolve({
          ok: true as const,
          text: next.text,
          version: next.version,
          encoding: next.encoding ?? 'utf8',
          hasBom: next.hasBom ?? false,
          lineEnding: next.lineEnding ?? 'lf',
        });
      },
      getContent: () =>
        Promise.resolve({
          text: current.text,
          version: current.version,
          dirty: current.dirty ?? false,
          absPath: current.absPath ?? null,
          fileMissing: current.fileMissing ?? false,
          unloadable: current.unloadable ?? false,
          encoding: current.encoding ?? 'utf8',
          hasBom: current.hasBom ?? false,
          lineEnding: current.lineEnding ?? 'lf',
        }),
      onSync: (fn: (msg: unknown) => void) => {
        listeners.push(fn);
        return () => {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        };
      },
      dispatch: (msg: unknown) => dispatched.push(msg),
    },
  });

  const panel: Panel = {
    type: 'panel',
    id: panelId,
    originProjectId: PROJECT,
    title: 'Panel 1',
    kind: 'editor',
    ...(current.absPath ? { config: { filePath: current.absPath } } : {}),
  };

  /*
   * The layout holds THIS panel, kind and all — not the placeholder `createDefaultLayout` makes.
   *
   * `makePanel` builds `{ type, id, originProjectId, title }` with NO `kind`, because a fresh tab's
   * panel has not been given one yet. Every consumer that asks what kind of panel this is therefore
   * got `undefined` from the layout while the mounted component was plainly an editor — and one of
   * them filters on it: `missing-file-watcher` scans `collectPanels(tab.root).filter(p => p.kind ===
   * EDITOR_KIND)`, which over the placeholder is the empty list.
   *
   * That is silent in the worst way. A test mounting the watcher would see it report nothing, which
   * is what a passing scan looks like, and a repro written against it would be red because the scan
   * never ran rather than because of the defect it was written for. Measured exactly once, on #369.
   */
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: panelId });
  layout.tabs[0].root = panel;
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };

  /**
   * What the tree's config context holds, refreshed on every render that changes it.
   *
   * A witness rather than a second read of `opts.settings`: the question a test needs answered is
   * whether the PROVIDER has adopted the payload yet, and only something rendered under the
   * provider can answer that. It sits beside the editor in the same subtree, so it re-renders in
   * the same commit — when this says the settings have landed, `use-editor`'s `metaRef` is holding
   * them too.
   */
  const witness: { settings: AppSettings | null; loaded: boolean } = {
    settings: null,
    loaded: false,
  };
  const SettingsWitness = (): null => {
    witness.settings = useAppSettings();
    witness.loaded = useConfigLoaded();
    return null;
  };

  const tree = (): ReactElement =>
    createElement(
      ConfigProvider,
      null,
      createElement(SettingsWitness, null),
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
                  createElement(
                    Fragment,
                    null,
                    createElement(EditorPanel, {
                      panel,
                      tabId: 't1',
                      projectRoot,
                      rootless: opts.rootless ?? false,
                    }),
                    opts.withNotices ? createElement(EditorNoticeDialog, null) : null,
                    opts.withMissingFileWatcher ? createElement(MissingFileWatcher, null) : null,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

  render(tree());

  return {
    dispatched,
    calls,
    pushReset(doc: EditorDoc) {
      current = { ...current, ...doc };
      broadcastReset(doc);
    },
    pushMoved(absPath: string) {
      current = { ...current, absPath };
      for (const fn of [...listeners]) fn({ panelId, movedTo: absPath });
    },
    pushSync(msg: Record<string, unknown>) {
      for (const fn of [...listeners]) fn({ panelId, ...msg });
    },
    pushSettings(settings: Record<string, unknown>) {
      for (const fn of [...configListeners]) fn({ settings });
    },
    settings(): AppSettings {
      if (!witness.settings) throw new Error('the config provider has not rendered yet');
      return witness.settings;
    },
    settingsLoaded(): boolean {
      return witness.loaded;
    },
    async openFile(doc: EditorDoc & { absPath: string }) {
      pendingOpens.set(doc.absPath, doc);
      const actions = getEditorActions(panelId);
      if (!actions) throw new Error('the editor registered no actions — did it finish mounting?');
      await actions.openFile(doc.absPath);
    },
    content(): HTMLElement {
      const el = document.querySelector<HTMLElement>('.cm-content');
      if (!el) throw new Error('the editor did not mount a CodeMirror content element');
      return el;
    },
    view(): EditorView {
      /*
       * Read the DOCUMENT from the view rather than from the rendered `.cm-line`s. CodeMirror
       * virtualises its viewport, and in jsdom — where every rect is 0×0 — what is in the DOM is not
       * a reliable statement about what is in the document. `state.doc` is.
       */
      const el = document.querySelector<HTMLElement>('.cm-editor');
      const found = el ? EditorView.findFromDOM(el) : null;
      if (!found) throw new Error('no live EditorView — did the panel finish mounting?');
      return found;
    },
    text(): string {
      const el = document.querySelector<HTMLElement>('.cm-editor');
      if (!el) throw new Error('no editor');
      return [...el.querySelectorAll('.cm-line')].map((l) => l.textContent ?? '').join('\n');
    },
  };
}
