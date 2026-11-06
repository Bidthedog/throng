import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, sleep, type AttentionHarness } from './attention-harness.js';

/**
 * #555 — the reason throng ended a terminal must reach the panel with the exit.
 *
 * A real `TerminalService` over a fake PTY host: the host ends a terminal with a failure, as the
 * de-elevated agent host does when its agent never connects, and the published `terminal.exit` must carry
 * it. The panel reverts to its type form on that exit and the terminal's own text goes with it, so the
 * exit is the only thing left to say why.
 */

const live: AttentionHarness[] = [];

afterEach(async () => {
  for (const h of live.splice(0)) await h.stop();
});

async function exitsAfter(fire: (h: AttentionHarness) => void): Promise<any[]> {
  const h = makeHarness();
  live.push(h);
  await h.attach();
  fire(h);
  // The exit is published once the project lock is released (051 R7), a microtask or two later.
  for (let i = 0; i < 50 && h.exits.length === 0; i += 1) await sleep(10);
  return h.exits;
}

describe('#555 — terminal.exit carries the failure throng ended a terminal with', () => {
  it('publishes the failure kind and its raw detail', async () => {
    const exits = await exitsAfter((h) =>
      h.host.fireExit({ code: 1, failure: { kind: 'agent-never-started', detail: 'exit 5' } }),
    );
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ code: 1, unexpected: true, failure: { kind: 'agent-never-started', detail: 'exit 5' } });
  });

  it("control: a shell's own exit publishes no failure", async () => {
    const exits = await exitsAfter((h) => h.host.fireExit({ code: 2 }));
    expect(exits).toHaveLength(1);
    expect(exits[0]).not.toHaveProperty('failure');
  });
});
