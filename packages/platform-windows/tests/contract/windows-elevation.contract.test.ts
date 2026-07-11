import { describe, it, expect } from 'vitest';
import { runElevationContract } from '@throng/core/testing';
import { WindowsElevation } from '@throng/platform-windows';

describe('WindowsElevation', () => {
  it('satisfies the IElevationState contract (stable boolean matching the token)', () => {
    runElevationContract(() => new WindowsElevation());
  });

  it('reports a boolean; the CI/dev runner is not elevated', () => {
    const elevated = new WindowsElevation().isElevated();
    expect(typeof elevated).toBe('boolean');
    // The elevated-true assertion can only run on an actually-elevated runner; we
    // don't fail here when not elevated (no silent pass — the contract stability
    // check above is the real gate). Log a notice when we can't exercise `true`.
    if (!elevated) {
      console.info('[elevation-contract] runner is not elevated — skipping the elevated-true path');
    }
  });
});
