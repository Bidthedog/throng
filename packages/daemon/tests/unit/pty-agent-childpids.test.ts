import { describe, expect, it } from 'vitest';
import { answerChildPids } from '../../src/pty-agent-childpids.js';

/**
 * 046 branch review #2 — the PTY agent's answer to `childpids`.
 *
 * The agent used to turn a failed probe into `pids: []`, which is exactly what an idle shell looks
 * like: the daemon then counted a running process as idle and Unload's `closeIdle` ended it. A
 * failure now travels as `failed: true`, and the daemon treats that terminal as busy.
 */

const msg = { op: 'childpids' as const, key: 7, reqId: 3 };

describe('answerChildPids (review #2)', () => {
  it('reports the pids the probe found', async () => {
    const ev = await answerChildPids(() => Promise.resolve([11, 12]), { pid: 500 }, msg, () => {});
    expect(ev).toEqual({ ev: 'childpids', key: 7, reqId: 3, pids: [11, 12] });
  });

  it('reports a FAILED probe as failed, never as an empty (idle-looking) list', async () => {
    const logged: string[] = [];
    const ev = await answerChildPids(
      () => Promise.reject(new Error('powershell timed out')),
      { pid: 500 },
      msg,
      (line) => logged.push(line),
    );
    expect(ev).toEqual({ ev: 'childpids', key: 7, reqId: 3, pids: [], failed: true });
    expect(logged.join('\n')).toContain('powershell timed out');
  });

  it('a key the agent no longer holds has no children — the terminal is gone, not unknown', async () => {
    const ev = await answerChildPids(() => Promise.reject(new Error('not called')), undefined, msg, () => {});
    expect(ev).toEqual({ ev: 'childpids', key: 7, reqId: 3, pids: [] });
  });
});
