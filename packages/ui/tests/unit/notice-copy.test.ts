import { describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from '../../src/renderer/common/clipboard-copy.js';
import type { NoticeInput } from '../../src/renderer/common/notification.js';
import type { NoticeSubject } from '@throng/core';

/**
 * 030 US5 / FR-055 — A COPY THAT FAILED SAYS SO.
 *
 * The copy control is the route the failure banner's own pointer sentence leads with, and the one
 * the notice offers for a message no user can accurately retype. If the clipboard write fails, the
 * button looks exactly as it does on success: nothing moves, nothing is said, and the user pastes
 * whatever was on the clipboard before — most likely something of their own, into a bug report,
 * believing it is the error.
 *
 * A failure to report a failure is the defect this whole feature exists to close, so it is reported
 * the same way everything else is: through the notice model, naming what it could not copy.
 *
 * Written at the UNIT layer because the copy path is deliberately pure — the clipboard bridge and
 * the raise are parameters, not globals — which is also what lets a REJECTED write be exercised at
 * all. There is no way to make a real OS clipboard fail on demand from an E2E.
 */

const panel: NoticeSubject = { kind: 'panel', name: 'Shell', tab: 'Main', project: 'Ghost' };

/** Collect what the copy path raised, in order. */
function recorder(): { raised: NoticeInput[]; notify: (n: NoticeInput) => void } {
  const raised: NoticeInput[] = [];
  return { raised, notify: (n) => raised.push(n) };
}

describe('copyToClipboard', () => {
  it('writes the text verbatim and raises nothing when it succeeds', async () => {
    const write = vi.fn(async () => {});
    const { raised, notify } = recorder();

    expect(await copyToClipboard('the whole error', panel, { write, notify })).toBe(true);

    // `verbatim` — the text goes on the clipboard exactly as it reads, with no editor line or
    // rectangle semantics attached to it (FR-054).
    expect(write).toHaveBeenCalledWith({ text: 'the whole error', mode: 'verbatim' });
    expect(raised, 'a successful copy announced itself').toEqual([]);
  });

  it('reports a rejected write through the notice model, naming what it could not copy', async () => {
    const boom = new Error('EACCES: clipboard is not available');
    const { raised, notify } = recorder();

    expect(
      await copyToClipboard('the whole error', panel, {
        write: async () => {
          throw boom;
        },
        notify,
      }),
    ).toBe(false);

    expect(raised).toHaveLength(1);
    const notice = raised[0]!;
    expect(notice.severity).toBe('error');
    // The SUBJECT is the thing the copy was about, so the heading composes to
    // "Couldn't copy Ghost — Main — Shell" rather than naming the clipboard, which the user did not
    // ask about and cannot act on.
    expect(notice.subject).toEqual(panel);
    expect(notice.action).toBe('copy');
    expect(notice.message).toBe('The details could not be put on the clipboard.');
    // The raw failure rides where every other raw failure rides — copyable, logged, never rendered.
    expect(notice.copyDetail).toContain('EACCES: clipboard is not available');
  });

  it('reports it when there is no clipboard bridge at all, rather than resolving quietly', async () => {
    // `window.throng?.clipboard?.write` is optional in the renderer's own typing: a build without
    // the preload bridge has no clipboard, and an optional call chain returns `undefined` — which is
    // indistinguishable from a successful write unless it is treated as the failure it is.
    const { raised, notify } = recorder();
    expect(await copyToClipboard('the whole error', panel, { notify })).toBe(false);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.message).toBe('The details could not be put on the clipboard.');
  });

  it('never raises a notice about an empty copy — there was nothing to put anywhere', async () => {
    // A control that copies nothing has nothing to report; raising here would turn an inert click
    // into an error the user has to dismiss.
    const write = vi.fn(async () => {});
    const { raised, notify } = recorder();
    expect(await copyToClipboard('', panel, { write, notify })).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(raised).toEqual([]);
  });
});
