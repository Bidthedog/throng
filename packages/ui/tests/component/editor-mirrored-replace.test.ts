/**
 * One editor panel shown in two windows (Sync to) — the window that did NOT ask for a new file follows
 * the file its panel now holds (044 FR-106d, FR-110; Principle XI).
 *
 * ══ THE BUG ══
 *
 * Found by the E2E phase, 6/6: open `a.txt` then `b.txt` in one editor, Sync the panel to a sub-workspace
 * window, delete `a.txt`, press Alt+Left in either window. The window where the key was pressed shows the
 * could-not-read banner for `a.txt`. The OTHER window shows an empty document whose pill, title and banner
 * still name `b.txt`.
 *
 * The window that asked learns the new path from its own `editor.load` answer. Every other view of the
 * panel has only what UI main RELAYS — so this file drives a mounted view with nothing but the relays a
 * REAL `EditorCoordinator` sends while another window steps the panel's history. No hand-written
 * messages: what the view is given is exactly what a second window receives.
 *
 * Two consumers of those relays, as for a moved file (`movedTo`): the mounted view (its pill and banner),
 * and `MovedPathSync`, which keeps THIS window's layout pointed at the file for every editor it holds,
 * mounted or not.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { MovedPathSync } from '../../src/renderer/editor/moved-path-sync.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PANEL = 'p-ed';
const A_TEXT = 'alpha body\n';
const B_TEXT = 'beta body\n';
const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let a: string;
let b: string;
let coord: EditorCoordinator;
/** Where UI main's relays go — the other window. Set once that window is listening. */
let relay: (msg: Record<string, unknown>) => void;
let ed: EditorHarness | undefined;
let ws: MountedWorkspace | undefined;

function meta(absPath: string): Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & { absPath: string } {
  return {
    panelId: PANEL,
    windowId: '1',
    ownerKind: 'project',
    ownerProjectId: 'proj-editor',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
  };
}

/** The step the OTHER window takes: a load carrying the history intent (contracts/navigation-history.md §3). */
const backTo = (absPath: string) =>
  coord.load({ ...meta(absPath), navigation: { kind: 'history', index: 0, filePath: absPath } });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-xwin-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-xwin-rec-'));
  a = join(root, 'a.txt');
  b = join(root, 'b.txt');
  await writeFile(a, A_TEXT);
  await writeFile(b, B_TEXT);
  relay = () => {};
  coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: (_sender, msg) => relay(msg as Record<string, unknown>),
    persistUndoHistory: () => false,
  });
  // The panel's history, as the bug report builds it: a.txt, then b.txt.
  expect((await coord.load(meta(a))).ok).toBe(true);
  expect((await coord.load(meta(b))).ok).toBe(true);
});

afterEach(async () => {
  ed?.unmount();
  ed = undefined;
  ws?.unmount();
  ws = undefined;
  coord.destroy(PANEL);
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
  for (const dir of [root, recoveryDir]) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Mount the second window's view of the panel, holding b.txt, and route main's relays into it. */
async function mountOtherWindow(): Promise<EditorHarness> {
  const version = (await coord.getContent(PANEL))!.version;
  ed = mountEditor({
    panelId: PANEL,
    doc: { text: B_TEXT, version, absPath: b },
    projectRoot: root,
    withHeader: true,
    registerProject: true,
  });
  const harness = ed;
  await waitFor(() => expect(fileNameShown()).toBe('b.txt'));
  relay = (msg) => act(() => harness.pushSync(msg));
  return harness;
}

const fileNameShown = (): string | null | undefined =>
  screen.queryByTestId(`panel-file-${PANEL}`)?.querySelector('.panel-box__file-name')?.textContent;

describe('the other window’s view follows the file its panel now holds', () => {
  it('Back onto a DELETED file: its pill and its banner name that file (FR-106d)', async () => {
    const other = await mountOtherWindow();
    await unlink(a);

    expect((await backTo(a)).ok).toBe(false);

    await waitFor(() => expect(other.view().state.doc.toString()).toBe(''));
    const banner = await screen.findByTestId(`panel-failure-${PANEL}`);
    await waitFor(() => expect(fileNameShown()).toBe('a.txt'));
    expect(banner.textContent).toContain('a.txt');
    expect(banner.textContent).not.toContain('b.txt');
  });

  it('Back onto a READABLE file: its pill names that file, over that file’s text', async () => {
    const other = await mountOtherWindow();

    expect((await backTo(a)).ok).toBe(true);

    await waitFor(() => expect(other.view().state.doc.toString()).toBe(A_TEXT));
    await waitFor(() => expect(fileNameShown()).toBe('a.txt'));
  });
});

describe('the other window’s LAYOUT follows it too (MovedPathSync)', () => {
  /** The synced editor sits in a background tab of the other window — not mounted, so only the layout hears. */
  function otherLayout(): WorkspaceLayout {
    const l = createDefaultLayout('proj', { tab: 't1', panel: 'u0' });
    const synced: Panel = { type: 'panel', id: PANEL, originProjectId: 'proj', title: 'Ed', kind: 'editor', config: { filePath: b } };
    l.tabs.push({ id: 't2', title: 'Tab 2', root: synced, activePanelId: PANEL });
    return l;
  }
  const filePathOf = (id: string): unknown =>
    (ws!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === id)?.config ?? {})
      .filePath;

  async function mountOtherLayout(): Promise<void> {
    const listeners: ((msg: Record<string, unknown>) => void)[] = [];
    ws = await mountWorkspace(otherLayout(), {
      extras: [createElement(MovedPathSync, { key: 'moved' })],
      throng: {
        editor: {
          onSync: (fn: (msg: Record<string, unknown>) => void) => {
            listeners.push(fn);
            return () => listeners.splice(listeners.indexOf(fn), 1);
          },
        },
      },
    });
    relay = (msg) => act(() => listeners.forEach((fn) => fn(msg)));
  }

  it('Back onto a DELETED file re-points the synced editor’s config.filePath', async () => {
    await mountOtherLayout();
    await unlink(a);

    await backTo(a);

    expect(filePathOf(PANEL)).toBe(a);
  });

  it('Back onto a READABLE file re-points it', async () => {
    await mountOtherLayout();

    await backTo(a);

    expect(filePathOf(PANEL)).toBe(a);
  });
});
