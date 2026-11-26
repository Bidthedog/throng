/**
 * 080 FR-013, FR-028 — a setting's, a command's and a theme token's description, shown on its row in Preferences,
 * is at most 100 characters; the detail belongs in the reference page the row's (?) opens.
 *
 * Iteration 1 cut every longer description, so the stage-1 ratchet is gone: no descriptor may exceed the limit.
 */
import { KEYBINDINGS_METADATA, SETTINGS_METADATA, THEME_METADATA } from '@throng/core';
import { describe, expect, it } from 'vitest';

const LIMIT = 100;

const REGISTRIES = [
  ['setting', SETTINGS_METADATA, 'docs/preferences.md'],
  ['key binding', KEYBINDINGS_METADATA, 'docs/key-bindings.md'],
  ['theme token', THEME_METADATA, 'the theme settings reference'],
] as const;

describe(`descriptions are at most ${LIMIT} characters (080 FR-013, FR-028)`, () => {
  it.each(REGISTRIES)('every %s description fits', (_what, registry, home) => {
    const offenders = registry
      .filter((d) => d.description.length > LIMIT)
      .map((d) => `${d.key} (${d.description.length})`);
    expect(offenders, `shorten these descriptions to ${LIMIT} characters or fewer; put the detail in ${home}`).toEqual([]);
  });
});
