/**
 * 043 T142 / FR-073, FR-033c, R25 — retiring one value of a live enum, by SUBTRACTION.
 *
 * ══ WHAT IS BEING RETIRED, AND WHERE THE MIGRATION LIVES ══
 *
 * FR-073 withdraws per-folder grouping. The remembered grouping is per project and in memory, so it
 * dies with the process — but `search.inFiles.defaultGrouping` REACHES DISK, and someone running the
 * shipped build may already have `'folder'` persisted in `settings.json`. FR-033c is explicit about
 * what must then happen: such a value "MUST be read as the FR-033a default rather than rejected".
 *
 * No coercion is hand-written for it, and R25 records why. `search.inFiles.defaultGrouping` is
 * deliberately parsed as a BARE STRING with no membership check (`app-settings.ts`, which says so in
 * as many words: "`allowedValues` on the descriptor is the single statement of the set, and the guard
 * substitutes the default for anything outside it"). The guard is `correctScalar` in
 * `bounds-guard.ts`, and the set it reads is `FIND_IN_FILES_GROUPINGS` by way of the descriptor's
 * `allowedValues`. So DELETING `'folder'` FROM THAT ARRAY IS THE WHOLE MIGRATION — this file is what
 * proves the claim rather than assuming it, because the cost of the claim being wrong is a stored
 * value that throws or sticks on a grouping the application can no longer render.
 *
 * ══ THE JSON EDITOR'S COMPLAINT IS ASSERTED, NOT SUPPRESSED (plan D3) ══
 *
 * `settings-validity.ts` reads the same `allowedValues` to tell a user what is wrong with a document
 * they are typing, and it does NOT correct — it reports. So a document still holding `'folder'` will
 * draw `must be one of: file, fileAndFolder` in the JSON editor until the next ordinary write. That
 * is accurate (the value is not one of the two), transient (the first form write persists the coerced
 * value), and deliberately left alone: silencing it would mean a permanent carve-out for one retired
 * value inside a general checker. It is asserted here so that a later reader meets it as a decision
 * rather than discovering it as a bug.
 */
import { describe, expect, it } from 'vitest';
import {
  checkSettingsText,
  DEFAULT_APP_SETTINGS,
  FIND_IN_FILES_GROUPINGS,
  parseSettingsGuarded,
  SETTINGS_METADATA,
} from '../../src/index.js';

/** A settings document holding nothing but the retired grouping. */
const storedFolder = (): Record<string, unknown> => ({
  search: { inFiles: { defaultGrouping: 'folder' } },
});

describe('FR-073 — `folder` is no longer one of the groupings', () => {
  it('leaves exactly two values in FIND_IN_FILES_GROUPINGS', () => {
    expect([...FIND_IN_FILES_GROUPINGS]).toEqual(['file', 'fileAndFolder']);
  });

  it('describes only those two on the preference, and names no value the guard would reject', () => {
    const d = SETTINGS_METADATA.find((x) => x.key === 'search.inFiles.defaultGrouping');
    expect(d).toBeDefined();
    expect(d?.allowedValues).toEqual(FIND_IN_FILES_GROUPINGS);
    /*
     * `optionLabels` and `allowedValues` are two statements about one set, and the failure mode of a
     * drift is a select offering an option the guard silently replaces on the next read — a control
     * that appears to do nothing. So the labels may name no value outside the allowed set.
     */
    expect(Object.keys(d?.optionLabels ?? {}).sort()).toEqual([...FIND_IN_FILES_GROUPINGS].sort());
  });
});

describe('FR-033c — a stored `folder` is coerced, never rejected (R25)', () => {
  it('reads as the FR-033a default rather than as `folder`', () => {
    const out = parseSettingsGuarded(storedFolder());
    expect(out.value.search.inFiles.defaultGrouping).toBe(
      DEFAULT_APP_SETTINGS.search.inFiles.defaultGrouping,
    );
    expect(out.value.search.inFiles.defaultGrouping).toBe('file');
  });

  it('records a `default-substituted` correction naming the retired value', () => {
    // The correction is what makes this a migration rather than a silent overwrite: it is the
    // signal `writeConfigPatch` uses to persist the coerced value on the next ordinary write.
    const out = parseSettingsGuarded(storedFolder());
    expect(out.corrected).toBe(true);
    expect(out.corrections).toContainEqual({
      path: 'search.inFiles.defaultGrouping',
      kind: 'default-substituted',
      from: 'folder',
      to: 'file',
    });
  });

  it('is not rejected — the document stays readable and every sibling survives', () => {
    // "Rather than rejected" is the operative half of FR-033c. A retired value must not make the
    // document unreadable, and must not take the settings around it down with it.
    const raw = storedFolder();
    (raw.search as Record<string, unknown>).inFiles = {
      ...(raw.search as { inFiles: Record<string, unknown> }).inFiles,
      rememberGrouping: false,
      settleMs: 400,
    };

    const out = parseSettingsGuarded(raw);
    expect(out.unreadable).toBe(false);
    expect(out.value.search.inFiles.rememberGrouping).toBe(false);
    expect(out.value.search.inFiles.settleMs).toBe(400);
  });

  it('coerces on EVERY read, so nothing depends on a one-off rewrite having run', () => {
    const first = parseSettingsGuarded(storedFolder()).value.search.inFiles.defaultGrouping;
    const second = parseSettingsGuarded(storedFolder()).value.search.inFiles.defaultGrouping;
    expect([first, second]).toEqual(['file', 'file']);
  });

  it('leaves a surviving grouping exactly as it found it', () => {
    // The guard substitutes only what falls OUTSIDE the set. If it moved `fileAndFolder` too, the
    // tests above would pass for the wrong reason.
    const out = parseSettingsGuarded({ search: { inFiles: { defaultGrouping: 'fileAndFolder' } } });
    expect(out.value.search.inFiles.defaultGrouping).toBe('fileAndFolder');
    expect(out.corrections.some((c) => c.path === 'search.inFiles.defaultGrouping')).toBe(false);
  });
});

describe('plan D3 — the JSON editor reports the retired value, and that is accepted', () => {
  it('says `must be one of: file, fileAndFolder` for a document still holding `folder`', () => {
    const validity = checkSettingsText(JSON.stringify(storedFolder()));
    expect(validity.kind).toBe('checked');
    const problems = validity.kind === 'checked' ? validity.problems : [];
    const problem = problems.find((p) => p.key === 'search.inFiles.defaultGrouping');
    expect(problem?.reason).toBe('must be one of: file, fileAndFolder');
    expect(problem?.foundText).toBe('"folder"');
  });
});
