import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 068 — every setting this spec adds has a descriptor (Principle X: nothing inert).
 *
 * This file used to be `settings-inertness-068.test.ts` and also checked, by matching source text,
 * that production code reads each key. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor check stays here.
 *
 * Layer: unit — the descriptor model, no app.
 */

const NEW_KEYS = [
  {
    key: 'notifications.toastDurationMs',
    governs: 'how long every toast stays before it leaves (FR-021c)',
  },
  {
    key: 'notifications.toastWidthPx',
    governs: 'how wide every toast is (FR-076)',
  },
  {
    key: 'notifications.confirmDismissAll',
    governs: 'whether Dismiss all asks first (FR-026c)',
  },
  {
    key: 'notifications.panelLimit',
    governs: 'how many entries the Notifications panel keeps before dropping the oldest (FR-031d)',
  },
] as const;

describe('068 describes every setting it adds', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it.each(NEW_KEYS)('$key has a descriptor', ({ key }) => {
    expect(declared).toContain(key);
  });
});
