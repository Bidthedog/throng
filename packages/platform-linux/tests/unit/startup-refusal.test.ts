import { describe, expect, it } from 'vitest';
import { startupRefusal } from '@throng/platform-linux';

describe('starting as root (062 FR-019)', () => {
  it('is refused in words that say what to do', () => {
    expect(startupRefusal(0)).toMatch(/normal user.*sudo inside a terminal/);
  });

  it('is the only refusal', () => {
    expect(startupRefusal(1000)).toBeNull();
    expect(startupRefusal(undefined)).toBeNull();
  });
});
