/**
 * 044, 2026-09-16 iteration (FR-122d, FR-122e, FR-122a) — `preview.toggleSyncScroll`, pressed through the
 * window key handler `PreviewCommands` installs.
 *
 * The command ships unbound, so every case binds it to a test chord first. It acts — one key-scoped patch
 * of the scroll-sync setting, and the key taken — only where the toggle is on screen: an editor whose file
 * has a text provider, or a text preview. Anywhere else the chord is left alone for whatever else wants
 * it, and nothing is written (FR-122a, "absent when meaningless").
 *
 * Mounted as `window-arrow-chords.test.ts` mounts its window handler: a layout the test writes, the
 * window's providers, and the handler itself — no panel components, because the command decides from the
 * layout and the per-panel stores, not from anything drawn.
 */
import { act, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_KIND, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { PreviewCommands } from '../../src/renderer/preview/preview-commands.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { __resetPreviewStore, applyPreviewUpdate } from '../../src/renderer/preview/preview-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const ROOT = 'D:/proj';
const CHORD = { key: 'F8', code: 'F8', ctrlKey: true, altKey: true };
const PATCH = [{ path: ['editor', 'previews', 'syncScroll'], value: false }];

let m: MountedWorkspace | undefined;

const panel = (id: string, kind: string, config: Record<string, unknown> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind,
  config,
});

function layoutWith(active: Panel): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: active.id });
  l.tabs[0].root = active;
  l.tabs[0].activePanelId = active.id;
  return l;
}

function editorOn(id: string, filePath: string): Panel {
  setEditorState(id, { panelId: id, filePath, ownerRoot: ROOT, ownerKind: 'project', ownerProjectId: PROJECT });
  return panel(id, 'editor', { filePath });
}

async function mount(
  active: Panel,
  opts: { bound?: boolean; settings?: Record<string, unknown> } = {},
): Promise<ReturnType<typeof vi.fn>> {
  const writePatch = vi.fn(() => Promise.resolve({ ok: true }));
  const bound = opts.bound ?? true;
  m = await mountWorkspace(layoutWith(active), {
    extras: [createElement(PreviewCommands, { key: 'preview-commands' })],
    throng: {
      config: {
        get: () =>
          Promise.resolve({
            settings: opts.settings ?? {},
            keybindings: { bindings: bound ? { 'preview.toggleSyncScroll': ['Ctrl+Alt+F8'] } : {} },
          }),
        onChange: () => () => {},
        writePatch,
      },
    },
  });
  // The first config payload (the binding) lands a microtask after the layout.
  await act(() => Promise.resolve());
  return writePatch;
}

/** Press the chord; `true` when the key was TAKEN (the handler called `preventDefault`). */
function pressChord(): boolean {
  let taken = false;
  act(() => {
    taken = !fireEvent.keyDown(document.body, CHORD);
  });
  return taken;
}

async function settle(): Promise<void> {
  await act(() => new Promise((r) => setTimeout(r, 20)));
}

beforeEach(() => {
  __resetPreviewStore();
  setActivePane('workspace');
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  for (const id of ['ed-md', 'ed-off', 'ed-none']) removeEditorState(id);
});

describe('preview.toggleSyncScroll acts where the toggle is shown (FR-122d, FR-122a)', () => {
  it('with an active editor on a file a text provider previews: one key-scoped patch, key taken', async () => {
    const writePatch = await mount(editorOn('ed-md', `${ROOT}/README.md`));
    await waitFor(() => expect(pressChord()).toBe(true));
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch).toHaveBeenCalledWith({ kind: 'settings' }, PATCH);
  });

  it('with an active text preview: the same', async () => {
    const preview = panel('pv-1', PREVIEW_KIND, { filePath: `${ROOT}/README.md` });
    applyPreviewUpdate({
      panelId: 'pv-1',
      revision: 1,
      filePath: `${ROOT}/README.md`,
      providerId: 'markdown',
      content: null,
      dirty: false,
      parent: null,
      notice: null,
    });
    const writePatch = await mount(preview);
    await waitFor(() => expect(pressChord()).toBe(true));
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch).toHaveBeenCalledWith({ kind: 'settings' }, PATCH);
  });

  it('with the editor’s provider switched off: still acts — no one provider governs the setting (FR-122a)', async () => {
    const writePatch = await mount(editorOn('ed-off', `${ROOT}/README.md`), {
      settings: { editor: { previews: { providers: { markdown: { enabled: false } } } } },
    });
    await waitFor(() => expect(pressChord()).toBe(true));
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch).toHaveBeenCalledWith({ kind: 'settings' }, PATCH);
  });
});

describe('preview.toggleSyncScroll leaves the key alone elsewhere', () => {
  it('with an active editor on a file no provider previews: nothing written, key not taken', async () => {
    const writePatch = await mount(editorOn('ed-none', `${ROOT}/main.ts`));
    expect(pressChord()).toBe(false);
    await settle();
    expect(writePatch).not.toHaveBeenCalled();
  });

  it('with an active terminal: nothing written, key not taken', async () => {
    const writePatch = await mount(panel('term-1', 'terminal'));
    expect(pressChord()).toBe(false);
    await settle();
    expect(writePatch).not.toHaveBeenCalled();
  });

  it('with the command unbound: nothing happens', async () => {
    const writePatch = await mount(editorOn('ed-md', `${ROOT}/README.md`), { bound: false });
    expect(pressChord()).toBe(false);
    await settle();
    expect(writePatch).not.toHaveBeenCalled();
  });
});
