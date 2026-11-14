import { describe, expect, it } from 'vitest';
import { effectiveToastDurationMs, toastPointerHoldEnabled } from '../../src/renderer/common/toast-duration.js';

// 068 FR-021, gate run 43340046866: the harness-only `?toastHold=off` seam over the pointer hold.
describe('toastPointerHoldEnabled', () => {
  it('holds on the pointer in a real run', () => {
    expect(toastPointerHoldEnabled('')).toBe(true);
    expect(toastPointerHoldEnabled('?prefs=general&toastMs=10000')).toBe(true);
  });

  it('does not hold on the pointer when the harness turns it off', () => {
    expect(toastPointerHoldEnabled('?toastHold=off')).toBe(false);
  });
});

// 068 research D11: the harness-only `?toastMs=` seam over the user's toast duration.
describe('effectiveToastDurationMs', () => {
  it('uses the setting when the URL carries no override', () => {
    expect(effectiveToastDurationMs(3000, '')).toBe(3000);
    expect(effectiveToastDurationMs(4500, '?prefs=general')).toBe(4500);
  });

  it('uses the harness override when one is present', () => {
    expect(effectiveToastDurationMs(3000, '?toastMs=30000')).toBe(30000);
  });

  it('ignores a bad, zero or negative override', () => {
    expect(effectiveToastDurationMs(3000, '?toastMs=abc')).toBe(3000);
    expect(effectiveToastDurationMs(3000, '?toastMs=0')).toBe(3000);
    expect(effectiveToastDurationMs(3000, '?toastMs=-5')).toBe(3000);
  });
});
