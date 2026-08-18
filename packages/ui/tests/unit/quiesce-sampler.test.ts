import { describe, it, expect } from 'vitest';
import { quiesceSampler } from '../e2e/quiesce-sampler.js';

/**
 * `quiesced()` replaces roughly 200 seconds of deliberate idling across the E2E suite, so its
 * decision is worth more than an E2E launch to check. Every one of these cases is a way the helper
 * could be wrong while still looking like it works.
 *
 * **Anti-vacuity control, run 2026-08-18.** Replacing the settle condition with a bare `true` fails
 * **5 of these 7**, so the suite bites. The second mutation is the one worth recording: dropping the
 * `previous !== null` guard, leaving `current === previous`, fails **nothing** — and that is correct
 * rather than a hole. `sample()` takes a `string`, and no string equals `null`, so the guard is
 * unreachable and no test can distinguish the two. It is kept for the reader, not for the machine.
 */
describe('quiesce sampler', () => {
  it('never calls the first read settled', () => {
    // The failure this catches is the loud one: a sampler that returns true immediately turns every
    // converted wait into no wait at all, and every following assertion into a coin toss.
    const s = quiesceSampler();
    expect(s.sample('anything at all')).toBe(false);
    expect(s.settled()).toBeNull();
  });

  it('settles when two consecutive reads agree', () => {
    const s = quiesceSampler();
    s.sample('drawing');
    expect(s.sample('drawing')).toBe(true);
    expect(s.settled()).toBe('drawing');
  });

  it('does not settle while the surface is still changing', () => {
    const s = quiesceSampler();
    for (const frame of ['a', 'ab', 'abc', 'abcd']) expect(s.sample(frame)).toBe(false);
    expect(s.settled()).toBeNull();
  });

  it('a surface that changes again after settling reports the later settled text', () => {
    // A TUI that goes quiet, repaints, then goes quiet again. The caller wants what is on screen at
    // the end, not the first lull — returning the stale text is how an assertion reads a frame that
    // no longer exists.
    const s = quiesceSampler();
    s.sample('first');
    expect(s.sample('first')).toBe(true);
    expect(s.sample('second')).toBe(false);
    expect(s.sample('second')).toBe(true);
    expect(s.settled()).toBe('second');
  });

  it('treats an alternating surface as never settled', () => {
    // A spinner. Two frames repeating forever agree with nothing, so this must keep returning false
    // until the caller's timeout fires — which is the finding, not a case to paper over.
    const s = quiesceSampler();
    for (let i = 0; i < 20; i++) expect(s.sample(i % 2 === 0 ? 'tick' : 'tock')).toBe(false);
    expect(s.settled()).toBeNull();
  });

  it('an empty surface can settle', () => {
    // '' is a legitimate steady state — a cleared screen. An implementation using falsiness rather
    // than a null check would never settle here and would time out on a blank terminal.
    const s = quiesceSampler();
    s.sample('');
    expect(s.sample('')).toBe(true);
    expect(s.settled()).toBe('');
  });

  it('samplers do not share state', () => {
    const a = quiesceSampler();
    const b = quiesceSampler();
    a.sample('x');
    expect(b.sample('x')).toBe(false);
  });
});
