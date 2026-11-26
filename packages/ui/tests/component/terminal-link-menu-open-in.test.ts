import { waitFor } from '@testing-library/react';
import { createElement, type MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';

/**
 * 081 FR-050 — a TERMINAL's Link menu over a local file offers the File Explorer's **Open In ▸** for that
 * file, built by the explorer's own `openInRows`, and each row performs the explorer's route: an editor
 * target opens the file, Terminal ▸ a flavour opens a shell in the file's folder.
 *
 * `link-position-open.test.ts`'s harness: a real `TerminalPanel` beside a mounted editor (`p-ed`,
 * titled "Panel 1", showing `notes.md`), with only `useTerminal` stubbed — it would mount xterm and
 * attach a shell, neither of which is the subject. The stub captures the panel's `apiRef` and fills
 * it with a terminal whose pointer rests on a file link and whose selection is empty, which is all
 * the panel's `onContextMenu` reads.
 */

const ROOT = 'C:/proj';
const NOTES = 'C:/proj/notes.md';
const FOO = 'C:/proj/src/foo.ts';
const WRITTEN = './src/foo.ts';

const captured = vi.hoisted(() => ({ apiRef: null as null | MutableRefObject<unknown> }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { apiRef?: MutableRefObject<unknown> }) => {
    captured.apiRef = opts.apiRef ?? null;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;

beforeEach(() => {
  captured.apiRef = null;
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

const BASH = { id: 'bash', label: 'Bash', defaultShellArguments: '' };

async function mountBoth(fooIsOpen = false) {
  const notifyTyped = vi.fn();
  const resolve = vi.fn(
    async (request: LinkResolutionRequest): Promise<LinkResolution> =>
      request.text === WRITTEN
        ? { ok: true, link: { path: FOO, kind: 'file', inProject: true, executable: false, preview: 'none' } }
        : { ok: false },
  );
  const terminalPanel = {
    type: 'panel',
    id: 'p-term',
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'cmd' },
  } as Panel;
  const h = mountEditor({
    doc: { text: 'unrelated notes\n', version: 1, absPath: NOTES },
    projectRoot: ROOT,
    registerProject: true,
    throng: {
      panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped },
      links: { resolve, reveal: async () => ({ ok: true as const }), open: async () => ({ ok: true as const }) },
      // 033 FR-030 — the flavour catalogue Open In ▸ Terminal offers.
      terminal: { listFlavours: async () => [BASH] },
    },
    extras: [createElement(TerminalPanel, { key: 'term', panel: terminalPanel, tabId: 't1', projectRoot: ROOT })],
  });
  harness = h;
  // 060 FR-045 — main's app-wide one-buffer answer for the resolved path, added to the harness's own
  // editor bridge rather than replacing it.
  const bridge = (window as unknown as { throng: { editor: Record<string, unknown> } }).throng.editor;
  bridge.isOpen = async (p: string) => fooIsOpen && p === FOO;
  h.serve({ absPath: FOO, text: 'export const foo = 1;\n', version: 2 });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe('unrelated notes\n'));
  await waitFor(() => expect(captured.apiRef, 'the TerminalPanel rendered').not.toBeNull());
  captured.apiRef!.current = {
    getSelection: () => '',
    getHoveredLink: () => ({
      kind: 'file',
      request: { text: WRITTEN, kind: 'detectedPath', panelId: 'p-term', baseDirectory: ROOT },
    }),
  };
  return { h, notifyTyped, resolve };
}

function rightClickTerminal(): void {
  const el = document.querySelector<HTMLElement>('[data-testid="terminal-p-term"]');
  if (!el) throw new Error('no terminal element');
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 }));
}

function menuItem(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="menu-item-${label}"]`);
  if (!el) throw new Error(`no "${label}" row on the menu`);
  return el;
}

/** Once main has answered, open Open In ▸ and answer its rows' labels. */
async function openInRows(): Promise<string[]> {
  await waitFor(() => expect(menuItem('Find in File Explorer').getAttribute('aria-disabled')).toBe('false'));
  menuItem('Open In').click();
  const flyout = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="submenu-Open In"]');
    if (!el) throw new Error('the Open In flyout did not open');
    return el;
  });
  return [...flyout.querySelectorAll<HTMLElement>(':scope > li[data-testid^="menu-item-"]')].map(
    (el) => el.getAttribute('data-testid')!.replace(/^menu-item-/, ''),
  );
}

describe('the terminal Link menu — Open In ▸ is the File Explorer’s (081 FR-050)', () => {
  it('the File Explorer’s rows for an in-project file, after one resolution', async () => {
    const m = await mountBoth();
    rightClickTerminal();
    expect(await openInRows()).toEqual([
      'OS File Explorer',
      'Open in OS Default Program',
      'Last Active Editor',
      'New Editor',
      'Terminal',
      'Search',
    ]);
    expect(m.resolve).toHaveBeenCalledTimes(1);
  });

  it('a file already open anywhere: one Current Editor row, which opens no new panel (060 FR-045)', async () => {
    const m = await mountBoth(true);
    rightClickTerminal();
    const rows = await openInRows();
    expect(rows).toContain('Current Editor');
    expect(rows).not.toContain('New Editor');
    menuItem('Current Editor').click();
    // It takes the last-active route (main's one-buffer check focuses the holder of an open file —
    // the fake main here does not model that), so no new editor panel is created.
    await waitFor(() => expect(m.h.calls.load).toHaveBeenCalled());
    expect(m.notifyTyped).not.toHaveBeenCalled();
  });

  it('New Editor opens a NEW editor panel, and the open editor keeps its file', async () => {
    const m = await mountBoth();
    rightClickTerminal();
    await openInRows();
    menuItem('New Editor').click();

    await waitFor(() => expect(m.notifyTyped).toHaveBeenCalledWith(expect.any(String), 'editor', { filePath: FOO }));
    expect(m.h.calls.load).not.toHaveBeenCalled();
  });

  it('Terminal ▸ a flavour opens a shell in the linked file’s folder (033 FR-031)', async () => {
    const m = await mountBoth();
    rightClickTerminal();
    await openInRows();
    menuItem('Terminal').click();
    await waitFor(() => expect(document.querySelector('[data-testid="menu-item-Bash"]')).not.toBeNull());
    menuItem('Bash').click();

    await waitFor(() =>
      expect(m.notifyTyped).toHaveBeenCalledWith(
        expect.any(String),
        'terminal',
        expect.objectContaining({ flavourId: 'bash', startDirectory: 'C:/proj/src' }),
      ),
    );
  });
});

