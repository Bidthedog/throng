import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_TERMINAL_PANEL_DEFAULTS } from '@throng/core';

/*
 * 039 — the shipped terminal seeds are written down TWICE, so a guard keeps them equal.
 *
 * `DEFAULT_APP_SETTINGS.terminals.default*` is the real shipped configuration.
 * `SHIPPED_TERMINAL_PANEL_DEFAULTS` is the last-resort fallback used by a panel-type context that
 * cannot reach the settings — it exists so a missed call site yields the CORRECT default rather
 * than silently reinstating the pre-039 literals.
 *
 * A duplicated constant is a drift waiting to happen, and drift between a stated default and the
 * code's actual default is exactly the defect 039 was written to repair (025 FR-015 said "off"
 * while `panel-type.ts` shipped "on" for two releases, with no amendment and a comment pointing at
 * a function that no longer existed). #307 tracks the general problem — that nothing detects a
 * requirement the code has stopped honouring. This test is the specific, cheap answer for the one
 * pair of constants 039 introduces: if someone changes the shipped default in one place and not the
 * other, the build fails here rather than a user finding out.
 */
describe('the panel-type fallback seeds match the shipped settings (039)', () => {
  it('agrees with DEFAULT_APP_SETTINGS.terminals field for field', () => {
    expect(SHIPPED_TERMINAL_PANEL_DEFAULTS).toEqual({
      rememberCommand: DEFAULT_APP_SETTINGS.terminals.defaultRememberCommand,
      rememberDirectory: DEFAULT_APP_SETTINGS.terminals.defaultRememberDirectory,
      runAsAdmin: DEFAULT_APP_SETTINGS.terminals.defaultRunAsAdmin,
    });
  });

  /*
   * Pinned separately from the equality above, and deliberately so. The test above would still
   * pass if BOTH constants were changed together — which is the right outcome for a considered
   * change to `rememberDirectory` or `runAsAdmin`, and the wrong one for `rememberCommand`.
   *
   * `rememberCommand: false` is not a preference someone may freely re-tune: 025 FR-047a permits a
   * captured command to re-run on the next cold start with no prompt PRECISELY BECAUSE FR-015
   * makes memory opt-in and off by default. Flip this to `true` and FR-047a's argument stops
   * holding, so this assertion is here to make anyone doing it read that sentence first.
   */
  it('ships command memory OFF, because 025 FR-047a depends on it (025 FR-015)', () => {
    expect(SHIPPED_TERMINAL_PANEL_DEFAULTS.rememberCommand).toBe(false);
    expect(DEFAULT_APP_SETTINGS.terminals.defaultRememberCommand).toBe(false);
  });
});
