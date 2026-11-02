import { describe, it } from 'vitest';
import { runElevationContract } from '@throng/core/testing';
import { WindowsElevation } from '@throng/platform-windows';

describe('WindowsElevation', () => {
  it('satisfies the IElevationState contract (stable boolean matching the token)', () => {
    runElevationContract(() => new WindowsElevation());
  });

  // DELETED: 'reports a boolean'. runElevationContract throws unless isElevated() returns a boolean
  // (elevation-contract.ts), so the contract above already fails on it.
});
