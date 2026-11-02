import { act, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';

/**
 * 008 FR-005 / SC-006 (moved down from terminal-slow-start.e2e.ts) — a terminal whose attach outlived its
 * budget shows a non-fatal "still starting" state with a retry; it does not present a hard error or an
 * exit, and the retry re-runs the attach and clears the state.
 *
 * Layer: component — what the panel renders for `onStillStarting` is `TerminalPanel`'s own state; the real
 * panel in jsdom with `useTerminal` stubbed (so the test calls the callbacks the hook would) shows it. The
 * hook's reading of the attach answer is terminal-slow-start-attach.test.ts.
 */

const ROOT = 'C:/proj';

type Opts = { attempt?: number; onStillStarting: () => void; onAttached: () => void };
const captured = vi.hoisted(() => ({ opts: null as null | Opts }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: Opts) => {
    captured.opts = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;
const PANEL_ID = 'p-term-slow';

beforeEach(() => {
  captured.opts = null;
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mountPanel(): Promise<void> {
  const panel = {
    type: 'panel',
    id: PANEL_ID,
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
}

const q = (id: string): Element | null => document.querySelector(`[data-testid="${id}"]`);

describe('008 FR-005 — a terminal still starting past the attach budget', () => {
  it('shows the "still starting" state with a retry, no exit or type form; retry re-attaches and clears it', async () => {
    await mountPanel();
    const firstAttempt = captured.opts!.attempt ?? 0;
    expect(q(`terminal-starting-${PANEL_ID}`), 'nothing is shown before the overrun').toBeNull();

    act(() => captured.opts!.onStillStarting());
    expect(q(`terminal-starting-${PANEL_ID}`), 'the non-fatal state appears').not.toBeNull();
    expect(q(`terminal-retry-${PANEL_ID}`), 'with a retry affordance').not.toBeNull();
    expect(q(`panel-type-form-${PANEL_ID}`), 'the panel did not revert to the type form').toBeNull();
    expect(q(`panel-exit-${PANEL_ID}`), 'no hard exit error').toBeNull();

    fireEvent.click(q(`terminal-retry-${PANEL_ID}`)!);
    expect(captured.opts!.attempt, 'retry bumps the attempt, which re-runs the attach').toBe(firstAttempt + 1);
    expect(q(`terminal-starting-${PANEL_ID}`), 'the state clears').toBeNull();

    act(() => captured.opts!.onAttached());
    expect(q(`terminal-starting-${PANEL_ID}`), 'and stays clear once the session attaches').toBeNull();
  });
});
