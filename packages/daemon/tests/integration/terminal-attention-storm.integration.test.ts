import { afterEach, describe, expect, it } from 'vitest';
import { BEL, config, makeHarness, sleep, type AttentionHarness } from '../unit/attention-harness.js';

/*
 * 057 SC-004 / Principle XII — measured, not assumed. 10 s of a 1,000-bell-a-second storm (10 chunks of 100 every
 * 100 ms, so the event loop and the rate-window timers run as they would), once with attention on and once
 * off. What is timed is the work the output path does for those chunks; the difference is what attention
 * costs. Layer: integration — a wall-clock soak is a cost measurement, not a unit claim, and it runs at the
 * regression tier. The rest of the attention producer's tests are unit tests (terminal-attention.test.ts).
 * Measured at authoring: 59 ms of handler work with attention off, 87 ms on, for 10,000 chunks (about 3 µs a
 * chunk), one signal published.
 */
const live: AttentionHarness[] = [];
async function harness(): Promise<AttentionHarness> {
  const h = makeHarness();
  live.push(h);
  await h.attach();
  return h;
}
afterEach(async () => {
  for (const h of live.splice(0)) await h.stop();
});

describe('terminal.attention producer cost (057)', () => {
  it('a sustained 1,000/s bell storm costs the output path within noise and publishes one signal (SC-004)', { tags: ['regression'] }, async () => {
    const STORM_MS = 10_000;
    const TICK_MS = 100;
    const PER_TICK = 100;
    const payload = `${'x'.repeat(256)}${BEL}`;

    // The two runs share one 10 s loop, each with its own harness and its own timed work, so the storm
    // lasts 10 s (SC-004) rather than 20 and event-loop jitter lands on both runs alike.
    const hOff = await harness();
    const hOn = await harness();
    await hOff.rpc('terminal.attentionConfig', config({ enabled: false }));
    await hOn.rpc('terminal.attentionConfig', config({ enabled: true }));
    const offTicks: number[] = [];
    const onTicks: number[] = [];
    const started = Date.now();
    let tick = 0;
    while (Date.now() - started < STORM_MS) {
      // Alternate which run goes first, so neither always pays for the other's allocation or GC.
      const order = tick % 2 === 0 ? [hOff, hOn] : [hOn, hOff];
      for (const h of order) {
        const t0 = performance.now();
        for (let i = 0; i < PER_TICK; i++) h.host.emit(payload);
        const spent = performance.now() - t0;
        if (h === hOn) onTicks.push(spent);
        else offTicks.push(spent);
      }
      tick += 1;
      const wait = started + tick * TICK_MS - Date.now();
      if (wait > 0) await sleep(wait);
    }
    // Each run's work is its ticks summed without the slowest 1%: a GC pause or a busy neighbour on a hosted runner lands
    // on one tick of one run (320 ms against 76 once on a hosted Mac, where the two runs otherwise differ by 20 to 50),
    // while a cost attention really adds is in every tick and survives the trim (070).
    const steady = (ticks: number[]): number =>
      [...ticks].sort((a, b) => a - b).slice(0, Math.ceil(ticks.length * 0.99)).reduce((a, b) => a + b, 0);
    const offMs = steady(offTicks);
    const onMs = steady(onTicks);
    const off = { workMs: offMs, signals: hOff.signals.length, bytes: hOff.outputs.join('').length };
    const on = { workMs: onMs, signals: hOn.signals.length, bytes: hOn.outputs.join('').length };
    console.log(
      `attention storm: ${off.workMs.toFixed(0)} ms of handler work off, ${on.workMs.toFixed(0)} ms on, ${on.signals} signal(s)`,
    );
    expect(on.bytes).toBe(off.bytes); // same bytes through either way
    expect(off.signals).toBe(0);
    expect(on.signals).toBe(1);
    // Noise bound: 10,000 chunks; attention may add at most 100 ms in all (10 µs a chunk) or the off run's
    // own cost again, whichever is larger — a loaded workstation moves both runs, not just one.
    expect(on.workMs - off.workMs).toBeLessThan(Math.max(100, off.workMs));
  }, 60_000);
});
