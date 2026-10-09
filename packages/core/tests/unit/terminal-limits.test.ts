import { describe, expect, it } from 'vitest';
import { TERMINAL_END_TIMEOUT_MS } from '../../src/index.js';

/**
 * 051 FR-013a — the time limit for ending a terminal is ONE named constant, so changing it is a
 * one-line edit. Every end request and the shutdown wait read it (through the terminal service's
 * injected settings, T012); this pins the value the clarification chose.
 */
describe('051 FR-013a — terminal end time limit', () => {
  it('is 5 seconds', () => {
    expect(TERMINAL_END_TIMEOUT_MS).toBe(5000);
  });
});
