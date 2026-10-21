/**
 * A window that opens after marks were raised shows them (057 T068, FR-002: the mark set is the same in
 * every window).
 *
 * Main broadcasts the whole set only when it CHANGES, so a window that opens, is torn off, or reloads
 * afterwards would show nothing until the next change. When the store attaches to the bridge it asks main
 * for the current set (`attention.getMarks`) and applies the answer — unless a broadcast already arrived,
 * which is newer than any answer still in flight.
 *
 * Layer: component — the REAL holder over the real store; the bridge is a stub with a controllable reply.
 *
 * ANTI-VACUITY CONTROL: drop the `getMarks` call and the first test fails; apply the answer
 * unconditionally and the "newer broadcast wins" test fails.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionMark } from '@throng/core';
import { ProjectRowLead } from '../../src/renderer/attention/holder-marks.js';
import { __resetAttentionStore } from '../../src/renderer/attention/attention-store.js';
import { makeMark } from './attention-fixtures.js';

let broadcast: (e: { marks: AttentionMark[] }) => void = () => {};
let reply: (marks: AttentionMark[]) => void = () => {};
let getMarks: ReturnType<typeof vi.fn<() => Promise<{ marks: AttentionMark[] }>>>;

beforeEach(() => {
  __resetAttentionStore();
  getMarks = vi.fn(() => new Promise<{ marks: AttentionMark[] }>((resolve) => (reply = (marks) => resolve({ marks }))));
  Reflect.set(window, 'throng', {
    attention: {
      onChanged: (cb: typeof broadcast) => {
        broadcast = cb;
        return () => {};
      },
      getMarks,
    },
  });
});
afterEach(() => {
  __resetAttentionStore();
  Reflect.deleteProperty(window, 'throng');
});

const mount = (): void => {
  render(createElement(ProjectRowLead, { projectId: 'proj', colour: '#3b82f6' }));
};

describe('the store attaching to the bridge', () => {
  it('pulls the current set, so a window opened after a raise shows the mark at once', async () => {
    mount();
    expect(screen.queryByTestId('attention-project-proj')).toBeNull();
    expect(getMarks).toHaveBeenCalledTimes(1);
    await act(async () => reply([makeMark('p1', 'proj')]));
    await waitFor(() => expect(screen.getByTestId('attention-project-proj')).toBeInTheDocument());
  });

  it('keeps a newer broadcast over a slower answer', async () => {
    mount();
    // A mark is cleared and main broadcasts the empty set while the pull is still in flight…
    act(() => broadcast({ marks: [] }));
    // …and the stale answer, which still has the mark, then lands.
    await act(async () => reply([makeMark('p1', 'proj')]));
    expect(screen.queryByTestId('attention-project-proj')).toBeNull();
  });

  it('asks once, however many holders subscribe', async () => {
    render(createElement('div', null, createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' }), createElement(ProjectRowLead, { projectId: 'b', colour: '#3b82f6' })));
    expect(getMarks).toHaveBeenCalledTimes(1);
  });

  it('survives a bridge without getMarks (an older preload) and a reply that rejects', async () => {
    Reflect.set(window, 'throng', { attention: { onChanged: () => () => {} } });
    expect(() => mount()).not.toThrow();
    __resetAttentionStore();
    Reflect.set(window, 'throng', {
      attention: { onChanged: () => () => {}, getMarks: () => Promise.reject(new Error('main is gone')) },
    });
    expect(() => mount()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
