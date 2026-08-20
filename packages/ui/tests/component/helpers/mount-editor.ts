import { render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createElement, Fragment, type ReactElement } from 'react';
import { vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
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
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { EditorPanel } from '../../../src/renderer/editor/editor-panel.js';
import { getEditorActions } from '../../../src/renderer/editor/editor-actions.js';
import { EditorNoticeDialog } from '../../../src/renderer/editor/editor-notice-dialog.js';

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
}): EditorHarness {
  const panelId = opts.panelId ?? 'p-ed';
  const projectRoot = opts.projectRoot ?? 'C:/proj';

  let current: EditorDoc = { dirty: false, absPath: null, ...opts.doc };
  const listeners: ((msg: unknown) => void)[] = [];
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
        Promise.resolve(
          opts.settings ? { settings: opts.settings } : { settings: undefined },
        ),
      onChange: () => () => {},
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

  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: panelId });
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

  const tree = (): ReactElement =>
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
