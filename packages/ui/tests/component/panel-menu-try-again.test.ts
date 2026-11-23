import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FailureCause, Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { BANNER_RETRY_FAILED } from '../../src/renderer/common/notice-text.js';

/**
 * MIGRATED FROM `packages/ui/tests/e2e/panel-failure-banner.e2e.ts` — `Try again from the panel MENU reports a
 * failed retry, in both panel types` (030 FR-042c, FR-045).
 *
 * Layer: component — what is under test is which function the menu item runs. The panel's menu builds
 * `tryAgain` in `panel-placeholder.tsx` (the editor's header menu) and `terminal-panel.tsx` (the terminal's
 * content menu); both must run the MOUNTED BANNER's retry (`retryPanelFailure`) rather than the operation
 * directly, or the banner never learns the retry failed and stays silent. A stubbed failing retry action (the
 * editor's `reload`, the terminal's attach failing again) shows it in jsdom, with no window and no real
 * unreadable folder. The banner's own control is `panel-failure-banner.test.ts`; the wiring to a real
 * unreadable file and failed shell stays at E2E.
 */

const ROOT = 'C:/proj';
const EDITOR_ID = 'p-menu-ed';
const TERMINAL_ID = 'p-menu-term';

let harness: EditorHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  removeEditorState(EDITOR_ID);
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

const bannerOf = (id: string): HTMLElement => screen.getByTestId(`panel-failure-${id}`);

describe('Try again from the editor’s panel menu (FR-042c, FR-045)', () => {
  it('runs the banner’s retry, so a failed re-read is reported on the banner', async () => {
    harness = mountEditor({
      panelId: EDITOR_ID,
      doc: { text: '', version: 1, absPath: `${ROOT}/gone/notes.txt`, unloadable: true },
      projectRoot: ROOT,
      withHeader: true,
      registerProject: true,
    });
    harness.calls.reload.mockResolvedValue({ ok: false });
    await screen.findByTestId(`panel-failure-${EDITOR_ID}`);
    expect(
      bannerOf(EDITOR_ID),
      'the banner came back already reporting a failed retry — this test cannot prove anything',
    ).not.toHaveTextContent(BANNER_RETRY_FAILED);

    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${EDITOR_ID}`), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('menu-item-Try again'));

    await waitFor(() => expect(harness!.calls.reload).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(bannerOf(EDITOR_ID), 'a menu retry that failed left the banner standing in silence').toHaveTextContent(
        BANNER_RETRY_FAILED,
      ),
    );
  });
});

const captured = vi.hoisted(() => ({
  opts: null as null | {
    attempt?: number;
    onError: (message: string, cause?: FailureCause) => void;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: NonNullable<typeof captured.opts>) => {
    captured.opts = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

const CAUSE: FailureCause = {
  kind: 'path-missing',
  subject: 'the project folder',
  raw: 'ENOENT: no such file or directory',
};

describe('Try again from the terminal’s panel menu (FR-042c, FR-045)', () => {
  beforeEach(() => {
    captured.opts = null;
  });

  it('runs the banner’s retry: the attach runs again, and its failing again is reported on the banner', async () => {
    const panel = {
      type: 'panel',
      id: TERMINAL_ID,
      originProjectId: 'proj-editor',
      title: 'Terminal',
      kind: 'terminal',
      config: { flavourId: 'cmd' },
    } as unknown as Panel;
    harness = mountEditor({
      doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
      projectRoot: ROOT,
      registerProject: true,
      throng: { terminal: {} },
      extras: [createElement(TerminalPanel, { key: 'term', panel, tabId: 't1', projectRoot: ROOT })],
    });
    await waitFor(() => expect(captured.opts, 'the TerminalPanel rendered').not.toBeNull());

    // The start fails: the panel keeps its type and shows the shared banner.
    act(() => captured.opts!.onError(CAUSE.raw, CAUSE));
    await screen.findByTestId(`panel-failure-${TERMINAL_ID}`);
    expect(bannerOf(TERMINAL_ID)).not.toHaveTextContent(BANNER_RETRY_FAILED);
    const attemptBefore = captured.opts!.attempt ?? 0;

    fireEvent.contextMenu(screen.getByTestId(`terminal-${TERMINAL_ID}`), { clientX: 20, clientY: 120 });
    fireEvent.click(await screen.findByTestId('menu-item-Try again'));

    await waitFor(() => expect(captured.opts!.attempt, 'the menu re-ran the attach').toBe(attemptBefore + 1));
    // The re-attach fails again, as the real one does while the folder is still gone.
    act(() => captured.opts!.onError(CAUSE.raw, CAUSE));

    await waitFor(() =>
      expect(bannerOf(TERMINAL_ID), 'a menu retry that failed left the banner standing in silence').toHaveTextContent(
        BANNER_RETRY_FAILED,
      ),
    );
  });
});
