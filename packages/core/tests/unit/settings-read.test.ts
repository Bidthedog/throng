/**
 * 032 T023 — `unreadable` says something `corrected` cannot (FR-008).
 *
 * The two flags mean opposite things to a caller and the distinction is the whole point:
 *
 *   - `corrected` — "this document was fine, bar a value I clamped". The value is trustworthy and
 *     the file is owed a write-back.
 *   - `unreadable` — "I could not use this document at all, so what you are holding is the shipped
 *     defaults". The value is a fallback, and writing it back would replace the user's file.
 *
 * The watcher could not previously tell them apart, so an unusable document broadcast the defaults
 * exactly as a clean one broadcasts the real settings — and nothing re-read.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseSettingsGuarded } from '../../src/index.js';

describe('parseSettingsGuarded — unreadable', () => {
  it.each([
    ['an array', [] as unknown],
    ['a string', 'settings'],
    ['a number', 7],
    ['null', null],
  ])('reports %s as unreadable', (_label, raw) => {
    expect(parseSettingsGuarded(raw).unreadable).toBe(true);
  });

  it('does NOT report an absent document as unreadable', () => {
    // A machine with no settings file yet is a normal machine. Retrying would delay every first
    // launch to no purpose.
    expect(parseSettingsGuarded(undefined).unreadable).toBe(false);
  });

  it('does not report a clean document as unreadable', () => {
    const out = parseSettingsGuarded(DEFAULT_APP_SETTINGS);
    expect(out.unreadable).toBe(false);
    expect(out.corrected).toBe(false);
  });

  it('reports an out-of-range but PARSEABLE document as corrected, not unreadable', () => {
    // The distinction that matters: a value the guard can clamp is a usable document. Retrying it
    // would achieve nothing, and treating it as unreadable would delay every such read by the full
    // retry budget.
    const raw = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
    (raw.panes as { projects: { maxWidth: number } }).projects.maxWidth = 99_999;

    const out = parseSettingsGuarded(raw);
    expect(out.corrected).toBe(true);
    expect(out.unreadable).toBe(false);
  });

  it('still returns a usable value when the document is unreadable', () => {
    // It never throws — a malformed settings file must not stop the application starting.
    expect(parseSettingsGuarded('nonsense').value.appearance.theme).toBe(
      DEFAULT_APP_SETTINGS.appearance.theme,
    );
  });
});
