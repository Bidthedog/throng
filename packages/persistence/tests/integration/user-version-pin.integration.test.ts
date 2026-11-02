import { describe, expect, it } from 'vitest';
import { LATEST_VERSION } from '@throng/persistence';

/**
 * REWRITTEN by 016 — the SECOND version pin.
 *
 * The spec named ONE guard to retire (`no-editor-migration`). There were two. This one was written
 * for feature 007 and pinned the same v6 for its own reasons, so it would have failed identically
 * and for a reason nobody had written down. Finding it was the point of looking; deleting it to
 * make the migration pass would have thrown away the guard AND the record of why it existed.
 *
 * The pin is the number below: a migration added without the version being bumped, or bumped without the
 * migration, is caught by migration-runner.integration.test.ts, which asserts that a fresh store reaches
 * LATEST_VERSION.
 */
describe('the schema version and the migration chain agree', () => {
  it('LATEST_VERSION is 12 — 060 #532 adds a project\'s own Find in Files exclusions', () => {
    expect(LATEST_VERSION).toBe(12);
  });

  // DELETED: 'a freshly migrated store actually REACHES LATEST_VERSION'. migration-runner.integration.test.ts
  // ('creates the database file and migrates a fresh directory to the latest version') asserts the same
  // result.to and user_version against LATEST_VERSION.
});
