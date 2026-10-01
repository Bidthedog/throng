import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 048 FR-032 / FR-130 (T084) — a consolidated failure notice names each panel by the title its
 * HEADER shows, never by the raw stored `panel.title`.
 *
 * The stored title is now a generated fallback ("Blank Panel 3") that exists only to keep names
 * unique, and `panelDisplayTitle` shows it as plain "Blank Panel". So a row built from `.title` said
 * "Later — Blank Panel 3" about an editor whose header said "charlie" (`notice-a11y.e2e.ts`), and
 * "Blank Panel" about one whose header said "docs" (`notice-consolidation.e2e.ts`).
 *
 * The row's name comes from `useReportPanelFailure`, so this drives that hook directly with its
 * three seams stubbed and reads the `affected` row it hands to `notify`.
 */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));
const notified = vi.hoisted(() => ({ calls: [] as { affected?: { panelName: string }[] }[] }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));
vi.mock('../../src/renderer/state/projects-store.js', () => ({
  useProjects: () => ({ projects: [] }),
}));
vi.mock('../../src/renderer/common/notification.js', () => ({
  useNotify: () => ({ notify: (n: { affected?: { panelName: string }[] }) => void notified.calls.push(n) }),
}));

const { useReportPanelFailure } = await import('../../src/renderer/workspace/panel-failure-notice.js');
const { setEditorState, removeEditorState } = await import('../../src/renderer/editor/editor-state.js');
const { setTerminalTitle, clearTerminalTitle } = await import('../../src/renderer/terminal/title-store.js');

function layoutWith(panel: Record<string, unknown>): void {
  workspace.value = {
    layout: {
      projectId: 'proj',
      tabs: [{ id: 'tab-1', title: 'Later', root: { type: 'panel', ...panel }, activePanelId: panel.id }],
      activeTabId: 'tab-1',
    },
  };
}

/** Report a failure on `panelId` and return the name its row carries. */
function reportedName(panelId: string): string | undefined {
  const { result } = renderHook(() => useReportPanelFailure());
  result.current({ panelId, message: 'The file could not be opened.' });
  return notified.calls.at(-1)?.affected?.[0]?.panelName;
}

beforeEach(() => {
  notified.calls = [];
});

afterEach(() => {
  removeEditorState('p-ed');
  clearTerminalTitle('p-term');
});

describe('a consolidated notice row names the panel as its header does (FR-032)', () => {
  it('names an editor by its FILE, from the persisted config', () => {
    layoutWith({ id: 'p-ed', kind: 'editor', title: 'Blank Panel 3', config: { filePath: 'C:/work/charlie.md' } });

    expect(reportedName('p-ed')).toBe('charlie');
  });

  it('prefers the editor’s LIVE file over the persisted one', () => {
    layoutWith({ id: 'p-ed', kind: 'editor', title: 'Blank Panel 3', config: { filePath: 'C:/work/old.md' } });
    setEditorState('p-ed', { filePath: 'C:/work/docs.md' });

    expect(reportedName('p-ed')).toBe('docs');
  });

  it('names a terminal by its flavour before the shell announces a title', () => {
    layoutWith({
      id: 'p-term',
      kind: 'terminal',
      title: 'Blank Panel 2',
      config: { flavourId: 'cmd', flavourLabel: 'Command Prompt' },
    });

    expect(reportedName('p-term')).toBe('Command Prompt');
  });

  it('names a terminal by the LIVE window title once there is one', () => {
    layoutWith({
      id: 'p-term',
      kind: 'terminal',
      title: 'Blank Panel 2',
      config: { flavourId: 'cmd', flavourLabel: 'Command Prompt' },
    });
    setTerminalTitle('p-term', 'npm run dev');

    expect(reportedName('p-term')).toBe('npm run dev');
  });

  it('names an empty panel exactly "Blank Panel", with no number (FR-130)', () => {
    layoutWith({ id: 'p-blank', title: 'Blank Panel 7' });

    expect(reportedName('p-blank')).toBe('Blank Panel');
  });
});
