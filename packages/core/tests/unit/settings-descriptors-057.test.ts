import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 057 T049 — every setting this spec adds has a descriptor (Principle X, FR-061).
 *
 * This file used to be `settings-inertness-057.test.ts` and also checked, by matching source text,
 * that attention code reads each key — including the seven signal toggles, which the daemon reads
 * through a computed `signals[<name>]` gate. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor checks stay here.
 *
 * Layer: unit — the descriptor model, no app.
 */

const SIGNALS = [
  'processExited',
  'commandFinished',
  'bell',
  'notification',
  'progressEnded',
  'unseenOutput',
  'outputQuiet',
] as const;

const NEW_KEYS: readonly { key: string; governs: string }[] = [
  {
    key: 'attention.clearDelayMs',
    governs: 'how long a marked panel must be in view before its mark clears (FR-006)',
  },
  { key: 'notifications.os', governs: 'whether anything reaches the OS (FR-109)' },
  ...(['error', 'warning', 'info', 'success'] as const).map((type) => ({
    key: `notifications.${type}.os`,
    governs: `whether a ${type} notice also reaches the OS (FR-110)`,
  })),
  { key: 'notifications.attention.os', governs: 'whether a mark also reaches the OS (FR-111)' },
  {
    key: 'notifications.attention.toast',
    governs: 'whether a mark\'s toast is shown (FR-111, 068 FR-092)',
  },
  {
    key: 'notifications.attention.panel',
    governs: 'whether a mark is kept in the Notifications panel (068 FR-092)',
  },
  { key: 'attention.taskbarBadge', governs: 'whether the taskbar badge is drawn (FR-039)' },
  { key: 'terminals.attention.enabled', governs: 'whether any terminal raises a mark (FR-063)' },
  ...SIGNALS.map((name) => ({
    key: `terminals.attention.signals.${name}`,
    governs: `whether a ${name} event raises a mark (FR-061)`,
  })),
  {
    key: 'terminals.attention.quietSeconds',
    governs: 'how long a terminal is silent before Output went quiet fires (FR-061)',
  },
];

describe('057 describes every setting it adds (T049)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('covers all nineteen keys (068 FR-092 split the attention mode in two)', () => {
    expect(NEW_KEYS).toHaveLength(19);
  });

  it('describes every new key', () => {
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
