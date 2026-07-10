import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ATTACH_TIMEOUT_MS,
  DEFAULT_PING_TIMEOUT_MS,
  readUiSettings,
} from '../../src/main/ui-settings.js';

/**
 * 008 FR-004. The terminal attach budget is a distinct injected setting, defaulting to
 * a value sized for launching a shell — much larger than the health-check ping budget —
 * and overridable via THRONG_ATTACH_TIMEOUT_MS without touching the ping budget.
 */
describe('UI settings: attachTimeoutMs (008 FR-004)', () => {
  it('defaults attachTimeoutMs to a value much larger than pingTimeoutMs', () => {
    const settings = readUiSettings({});
    expect(settings.attachTimeoutMs).toBe(DEFAULT_ATTACH_TIMEOUT_MS);
    expect(settings.pingTimeoutMs).toBe(DEFAULT_PING_TIMEOUT_MS);
    // The attach budget must be strictly, and substantially, larger than the ping budget.
    expect(settings.attachTimeoutMs).toBeGreaterThan(settings.pingTimeoutMs);
    expect(settings.attachTimeoutMs).toBeGreaterThanOrEqual(settings.pingTimeoutMs * 2);
  });

  it('reads THRONG_ATTACH_TIMEOUT_MS as an override, independent of the ping budget', () => {
    const settings = readUiSettings({ THRONG_ATTACH_TIMEOUT_MS: '30000' });
    expect(settings.attachTimeoutMs).toBe(30000);
    expect(settings.pingTimeoutMs).toBe(DEFAULT_PING_TIMEOUT_MS); // unchanged
  });

  it('falls back to the default when the override is not a finite number', () => {
    expect(readUiSettings({ THRONG_ATTACH_TIMEOUT_MS: 'nonsense' }).attachTimeoutMs).toBe(
      DEFAULT_ATTACH_TIMEOUT_MS,
    );
  });
});
