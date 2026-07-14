import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/index.js';

/**
 * 018 / US8 — FR-045 / SC-008: the project settings dialog leaves the USER settings registry alone.
 *
 * The tempting design is to put "hidden paths" in Preferences next to everything else. It would be
 * wrong, and expensively so: that registry is user-scoped by construction, its completeness audit
 * asserts every key in it has a control, and feature 015's reset/revert machinery walks it to restore
 * shipped defaults. A project-scoped key placed in it would be one that "reset to defaults" could wipe
 * for EVERY project at once, and whose "shipped default" is meaningless — a project's hidden paths have
 * no factory setting.
 *
 * So the boundary is: project settings live in the project. This guard is what stops the next person —
 * reasonably, helpfully — from moving them, and it is shaped like the REQUIREMENT (no project-scoped key
 * anywhere in the registry, no scope concept in it) rather than like the change (the keys I happened not
 * to add).
 */

/**
 * Names that carry per-project DATA. Any of these in the USER registry is the mistake.
 *
 * Note what is deliberately NOT here: `newProject.startingFolder` mentions projects but is a genuine
 * user preference (where the folder picker opens). The line is *whose data is it* — not *does the word
 * "project" appear in the key*.
 */
const PROJECT_SCOPED = ['hiddenpaths', 'rootfolder', 'projectid'];

describe('FR-045 — project scope never enters the user settings registry', () => {
  it('no user-settings key is project-scoped', () => {
    const offenders = SETTINGS_METADATA.map((d) => d.key).filter((key) =>
      PROJECT_SCOPED.some((needle) => key.toLowerCase().includes(needle)),
    );
    expect(
      offenders,
      `these user-settings keys are project-scoped — they belong in the project, not the registry:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the registry has no scope concept at all', () => {
    // A `scope` field would be the first step toward one registry holding both — the design FR-045
    // forbids, because it puts project data behind a "reset all settings" button.
    const withScope = SETTINGS_METADATA.filter(
      (d) => 'scope' in (d as unknown as Record<string, unknown>),
    ).map((d) => d.key);
    expect(withScope).toEqual([]);
  });

  // The completeness audit itself (SC-008 — "passes UNCHANGED") is asserted where it has always been
  // asserted, in settings-metadata.test.ts. Re-running it here would be a second copy of the same
  // assertion drifting away from the first, which is precisely what US8 is meant to be avoiding.
});
