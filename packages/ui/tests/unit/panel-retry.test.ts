import { describe, expect, it, vi } from 'vitest';

import { attemptRetry } from '../../src/renderer/common/panel-retry.js';
import type { NoticeInput } from '../../src/renderer/common/notification.js';
import type { NoticeSubject } from '@throng/core';

/**
 * 030 US4 / FR-045 — A RETRY THAT COULD NOT EVEN BE ATTEMPTED SAYS SO.
 *
 * ══ THE DEFECT ══
 *
 * `PanelFailureBanner.retry` ran its attempt inside `try`/`finally` with no `catch`, on a promise
 * that was `void`ed. So a REJECTING `onRetry` settled the UI correctly — the control re-enabled, the
 * banner said the condition was still there — and lost the reason entirely: nothing notified,
 * nothing logged, nothing copyable, and an unhandled rejection at the top of the renderer.
 *
 * It is reachable, not theoretical. `editor-failure-banner.tsx` retries through
 * `use-editor.ts#reloadFromDisk`, which awaits a real IPC invoke; a channel that is gone, a main
 * process mid-teardown or a handler that throws all arrive here as a rejection. In a feature whose
 * entire subject is failures not vanishing, a failure to retry that vanishes is the sharpest
 * possible shape of the bug.
 *
 * ══ WHY THIS IS A UNIT TEST ══
 *
 * The same reason `notice-copy.test.ts` gives for the clipboard: the rejection cannot be produced
 * from an E2E. `window.throng.editor.reload` is exposed through `contextBridge` and cannot be
 * monkey-patched from the page, and there is no way to make a live IPC channel fail on demand. So
 * the rule lives in a module whose dependencies are PARAMETERS — `notify` is passed in, exactly as
 * `clipboard-copy.ts` takes `write` and `notify` — and the banner is the thin binding above it.
 */

const panel: NoticeSubject = { kind: 'panel', name: 'Shell', tab: 'Main', project: 'Ghost' };

/** Collect what the retry path raised, in order. */
function recorder(): { raised: NoticeInput[]; notify: (n: NoticeInput) => void } {
  const raised: NoticeInput[] = [];
  return { raised, notify: (n) => raised.push(n) };
}

describe('attemptRetry', () => {
  it('reports the outcome of an attempt that ran, and raises nothing either way', async () => {
    const { raised, notify } = recorder();

    expect(await attemptRetry(async () => true, panel, { notify })).toBe(true);
    // A retry that RAN and did not clear the condition is not an error: the banner is already the
    // report of it (FR-045), and a notice on top would announce the state the user is looking at.
    expect(await attemptRetry(async () => false, panel, { notify })).toBe(false);

    expect(raised, 'an attempt that ran to completion announced itself').toEqual([]);
  });

  it('reports a rejected attempt through the notice model, naming the panel it was about', async () => {
    const boom = new Error('EPIPE: the editor channel is gone');
    const { raised, notify } = recorder();

    expect(
      await attemptRetry(
        async () => {
          throw boom;
        },
        panel,
        { notify },
      ),
      'a rejected attempt must still settle as "did not succeed" — the control cannot stay disabled',
    ).toBe(false);

    expect(raised).toHaveLength(1);
    const notice = raised[0]!;
    expect(notice.severity).toBe('error');
    // Composes to `Couldn't retry Ghost — Main — Shell` (FR-019/FR-020) — what was attempted, on
    // what. The panel is named because a banner the reader can see is not the only place this text
    // ends up: it is copied and logged.
    expect(notice.action).toBe('retry');
    expect(notice.subject).toEqual(panel);
    // The raw failure rides where every other raw failure rides: copied and logged, never rendered
    // (FR-034).
    expect(notice.copyDetail).toBe('EPIPE: the editor channel is gone');
    expect(notice.message).not.toContain('EPIPE');
  });

  it('carries a non-Error rejection through as its own text rather than [object Object]', async () => {
    const { raised, notify } = recorder();

    expect(
      await attemptRetry(
        async () => {
          throw 'the daemon said no';
        },
        panel,
        { notify },
      ),
    ).toBe(false);

    expect(raised[0]?.copyDetail).toBe('the daemon said no');
  });

  it('does not let a throwing onRetry escape before it is even awaited', async () => {
    const { raised, notify } = recorder();
    // A synchronous throw — `onRetry` is typed as returning a promise, but a caller that throws
    // before its first await never produces one, and `await` on a call that threw is too late.
    const onRetry = vi.fn((): Promise<boolean> => {
      throw new Error('synchronous refusal');
    });

    expect(await attemptRetry(onRetry, panel, { notify })).toBe(false);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.copyDetail).toBe('synchronous refusal');
  });
});
