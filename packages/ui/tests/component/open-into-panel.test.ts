/**
 * 044 T139 — the ONE route for opening a file into an existing editor panel (contracts/navigation-history.md
 * §3, FR-106a–d).
 *
 * `openIntoEditorPanel` is what a tree open into the last active editor, a drop on an editor, and Back /
 * Forward all go through, so its outcomes are the outcomes of every one of them. History recording lives
 * in main's `load`; everything FR-106 says about the renderer follows from WHETHER the panel's load runs,
 * and with what intent. The load is reached through the panel's own `openFile` — the one path to
 * `editor.load` in the renderer — so "no load" is asserted as "openFile was never called".
 *
 * The bridge is `window.throng.editor.openInto` (the one-buffer oracle), faked per test. The prompt is the
 * real unsaved-open store, answered here as the dialog would answer it.
 */
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import {
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import { drainRefusedOpens } from '../../src/renderer/editor/refusal-store.js';
import { openIntoEditorPanel } from '../../src/renderer/editor/open-into-panel.js';
import type { UnsavedOpenChoice } from '../../src/renderer/editor/unsaved-open-store.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const A = 'D:/proj/a.ts';
const B = 'D:/proj/b.ts';

let m: MountedWorkspace | undefined;
const registered = new Set<string>();

function twoEditors(): WorkspaceLayout {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'One', kind: 'editor', config: { filePath: A } };
  const e2: Panel = { type: 'panel', id: 'e2', originProjectId: PROJECT, title: 'Two', kind: 'editor', config: { filePath: 'D:/proj/c.ts' } };
  layout.tabs[0].root = { type: 'split', orientation: 'row', children: [e1, e2], sizes: [0.5, 0.5] };
  layout.tabs[0].activePanelId = 'e1';
  return layout;
}

function asEditor(panelId: string, over: Partial<EditorActions> = {}) {
  const actions = {
    save: vi.fn(() => Promise.resolve(true)),
    saveAs: vi.fn(() => Promise.resolve(true)),
    isDirty: vi.fn(() => false),
    openFile: vi.fn(() => Promise.resolve()),
    revert: vi.fn(),
    reloadFromDisk: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  registerEditorActions(panelId, actions as unknown as EditorActions);
  registered.add(panelId);
  return actions;
}

async function mount(decision: unknown = { action: 'open' }): Promise<MountedWorkspace> {
  drainRefusedOpens();
  m = await mountWorkspace(twoEditors(), {
    throng: { editor: { openInto: vi.fn(() => Promise.resolve(decision)) } },
  });
  return m;
}

/** A prompt that answers `choice`, recording that it was asked. */
function answer(choice: UnsavedOpenChoice) {
  return vi.fn((_file: string, _editor: string) => Promise.resolve(choice));
}

const panels = (): Panel[] => collectPanels(m!.ws().layout!.tabs[0].root) as Panel[];

afterEach(() => {
  for (const id of registered) unregisterEditorActions(id);
  registered.clear();
  m?.unmount();
  m = undefined;
  drainRefusedOpens();
});

describe('a clean panel loads at once', () => {
  it('an ordinary open loads the file and answers loaded', async () => {
    await mount();
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'open' });
    expect(outcome).toBe('loaded');
    expect(e1.openFile).toHaveBeenCalledTimes(1);
    expect(e1.openFile).toHaveBeenCalledWith(B);
  });

  it('a history step loads with the history intent naming the entry', async () => {
    await mount();
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 });
    expect(outcome).toBe('loaded');
    expect(e1.openFile).toHaveBeenCalledWith(B, { navigation: { kind: 'history', index: 0, filePath: B } });
  });
});

describe('a dirty panel asks first (FR-106a)', () => {
  it('Cancel loads nothing and answers cancelled', async () => {
    await mount();
    const e1 = asEditor('e1', { isDirty: () => true });
    const prompt = answer('cancel');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 }, { prompt });
    expect(prompt).toHaveBeenCalledWith('b.ts', expect.any(String));
    expect(outcome).toBe('cancelled');
    expect(e1.openFile).not.toHaveBeenCalled();
  });

  it('Save & open with a failing save loads nothing and answers saveFailed', async () => {
    await mount();
    const e1 = asEditor('e1', { isDirty: () => true, save: vi.fn(() => Promise.resolve(false)) });
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 }, { prompt: answer('save') });
    expect(outcome).toBe('saveFailed');
    expect(e1.save).toHaveBeenCalledTimes(1);
    expect(e1.openFile).not.toHaveBeenCalled();
  });

  it.each(['discard', 'save'] as const)('%s & open loads with the intent', async (choice) => {
    await mount();
    const e1 = asEditor('e1', { isDirty: () => true });
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 2 }, { prompt: answer(choice) });
    expect(outcome).toBe('loaded');
    expect(e1.openFile).toHaveBeenCalledWith(B, { navigation: { kind: 'history', index: 2, filePath: B } });
    if (choice === 'save') expect(e1.save).toHaveBeenCalledTimes(1);
  });

  it('Open in new editor makes a new panel on the file and leaves this one unloaded', async () => {
    await mount();
    const e1 = asEditor('e1', { isDirty: () => true });
    expect(panels()).toHaveLength(2);
    let outcome = '';
    await act(async () => {
      outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 }, { prompt: answer('new') });
    });
    expect(outcome).toBe('openedInNew');
    expect(e1.openFile).not.toHaveBeenCalled();
    await waitFor(() => expect(panels()).toHaveLength(3));
    const created = panels().find((p) => p.id !== 'e1' && p.id !== 'e2')!;
    expect(created.kind).toBe('editor');
    // The new panel's history starts with that file: its first load is an ordinary one — no carried
    // history, nothing that would name this panel's position.
    expect(created.config).toEqual({ filePath: B });
  });
});

describe('the one-buffer rule and refusals', () => {
  it('a file open in ANOTHER editor focuses that editor and loads nothing here (FR-106b)', async () => {
    await mount({ action: 'focus', panelId: 'e2' });
    const e1 = asEditor('e1');
    let outcome = '';
    await act(async () => {
      outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 });
    });
    expect(outcome).toBe('focusedElsewhere');
    expect(e1.openFile).not.toHaveBeenCalled();
    expect(m!.ws().layout!.tabs[0].activePanelId).toBe('e2');
  });

  it('a refused file raises ONE notice naming it and loads nothing (FR-106c)', async () => {
    await mount({ action: 'refuse', reason: 'too-large' });
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 0 });
    expect(outcome).toBe('refused');
    expect(e1.openFile).not.toHaveBeenCalled();
    expect(drainRefusedOpens()).toEqual([{ absPath: B, reason: 'too-large' }]);
  });

  it('a history step past a MISSING-file refusal loads anyway, so the position moves (FR-106d)', async () => {
    await mount({ action: 'refuse', reason: 'missing' });
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 1 });
    expect(outcome).toBe('loaded');
    expect(e1.openFile).toHaveBeenCalledWith(B, { navigation: { kind: 'history', index: 1, filePath: B } });
    expect(drainRefusedOpens()).toEqual([]);
  });

  it('the bypass is for history only: an ordinary open still takes the missing-file refusal', async () => {
    await mount({ action: 'refuse', reason: 'missing' });
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'open' });
    expect(outcome).toBe('refused');
    expect(e1.openFile).not.toHaveBeenCalled();
  });

  it('a history step never bypasses a real refusal', async () => {
    await mount({ action: 'refuse', reason: 'binary' });
    const e1 = asEditor('e1');
    const outcome = await openIntoEditorPanel(m!.ws(), 'e1', B, { kind: 'history', index: 1 });
    expect(outcome).toBe('refused');
    expect(e1.openFile).not.toHaveBeenCalled();
  });
});
