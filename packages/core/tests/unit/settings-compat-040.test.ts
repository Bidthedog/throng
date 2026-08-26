import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { getAtPath, leavesOf } from '../../src/config/metadata.js';

/**
 * 040 FR-051 / SC-007 — a `settings.json` written BEFORE this feature loads with every value
 * intact, and the three new keys take their defaults.
 *
 * ══ WHAT UPGRADE ACTUALLY MEANS HERE ══
 *
 * An existing install has a `settings.json` on disk that predates 040. It has no
 * `editor.showGutter` and no `editor.statusBar` section at all. Two things must be true when it is
 * read by this version, and they fail independently:
 *
 *   1. Nothing the user set is lost, changed or quietly re-defaulted.
 *   2. The three new keys arrive at their shipped values — `true`, `true`, `true` — rather than as
 *      `undefined`, which would reach the renderer as a falsy value and turn the gutter and both
 *      readout groups OFF for every existing user on upgrade.
 *
 * The second is the one with teeth. `editorSettings` builds its result from a hand-listed object
 * literal, so a section that is absent from the document and unhandled in the literal is `undefined`
 * rather than defaulted — and `undefined` renders as "off" everywhere without any error at all.
 *
 * ══ WHY THE FIXTURE IS BUILT FROM THE DEFAULTS RATHER THAN PASTED IN ══
 *
 * A hand-written sample document would assert intactness only over the keys somebody remembered to
 * type, which is exactly the set least likely to break. Building it from the shipped defaults, then
 * DELETING what 040 added, gives a document covering every modelled key — and it keeps covering
 * them when keys are added later, without this file being edited.
 *
 * The overrides then make that sweep mean something: a parser that ignored the document entirely
 * and returned the defaults would satisfy a round trip of default values perfectly.
 */

/**
 * A spread of non-default values across every section — what a real user's file looks like after a
 * while. Each is checked against the shipped default below, so an override that silently became the
 * default (because someone changed the default) fails loudly rather than weakening the sweep.
 */
const OVERRIDES: readonly (readonly [string, unknown])[] = [
  ['appearance.theme', 'Matrix'],
  ['confirmations.destroyProject', 'none'],
  ['behaviour.tabHoverActivateMs', 250],
  ['explorer.autoRevealActiveFile', false],
  ['terminals.commandPollMs', 2000],
  ['terminals.shellIntegration', false],
  ['editor.autoSave', true],
  ['editor.autoSaveDebounceMs', 750],
  ['editor.maxOpenFileBytes', 2097152],
  ['editor.defaultWordWrap', false],
  ['editor.showStatusBar', false],
  ['editor.persistUndoHistory', false],
  ['editor.indent.indentWidth', 4],
  ['editor.navigation.rememberGotoLineNumber', true],
  ['tabs.maxNameLength', 32],
  ['search.asYouTypeDebounceMs', 250],
  ['diagnostics.keepFiles', 7],
  ['newProject.startingFolder', 'profile'],
] as const;

/** Everything 040 added to the settings model. Absent from any document written before it. */
const NEW_LEAVES = [
  'editor.showGutter',
  'editor.statusBar.showCursorPosition',
  'editor.statusBar.showCounts',
] as const;

/** Mutable view of a parsed JSON document, so a section can be deleted the way absence looks. */
type Doc = Record<string, unknown>;

/**
 * A `settings.json` as it stood before 040: the full modelled shape, user-modified, with 040's keys
 * removed. Built through JSON, because that is literally what the file is — no class instances, no
 * `undefined`, no shared references with the defaults.
 */
function preFeatureDocument(): Doc {
  const doc = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)) as Doc;
  for (const [path, value] of OVERRIDES) {
    const segs = path.split('.');
    let cur = doc;
    for (const seg of segs.slice(0, -1)) cur = cur[seg] as Doc;
    cur[segs[segs.length - 1]] = value;
  }
  const editor = doc.editor as Doc;
  delete editor.showGutter;
  delete editor.statusBar;
  return doc;
}

describe('a pre-040 settings.json loads with every value intact (FR-051)', () => {
  it('the fixture really is pre-040, and really does differ from the defaults', () => {
    /*
     * ANTI-VACUITY, and the premise of everything below. Two ways this file could pass while
     * proving nothing: a fixture that still contains 040's keys (so "they take their defaults" is
     * trivially about a value the document supplied), and a fixture identical to the defaults (so
     * "every value intact" is satisfied by a parser that ignores its input).
     */
    const doc = preFeatureDocument();
    for (const leaf of NEW_LEAVES) {
      expect(getAtPath(doc, leaf), `${leaf} is present in a fixture that claims to predate it`).toBe(
        undefined,
      );
    }
    expect((doc.editor as Doc).statusBar, 'the whole statusBar section must be absent').toBe(
      undefined,
    );
    for (const [path, value] of OVERRIDES) {
      expect(
        getAtPath(DEFAULT_APP_SETTINGS, path),
        `${path} is overridden to its own shipped default, so it proves nothing`,
      ).not.toEqual(value);
    }
  });

  it('returns every value the document held, unchanged', () => {
    /*
     * A sweep over every leaf of the document rather than over the overrides — so a key nobody
     * thought about is covered too, and so a key added to the model in a later feature joins this
     * assertion without anyone editing it.
     *
     * This is the guard against the silent-drop fault `app-settings.ts` warns about beside its own
     * literal: a field in the interface, the defaults and the local, but missing from the returned
     * object, compiles and ships, and the user's value comes back as the default with nothing
     * anywhere saying so.
     */
    const doc = preFeatureDocument();
    const parsed = parseAppSettings(doc);
    const lost: string[] = [];
    for (const leaf of leavesOf(doc)) {
      const before = getAtPath(doc, leaf);
      const after = getAtPath(parsed, leaf);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        lost.push(`${leaf}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      }
    }
    expect(
      lost,
      `Reading a pre-040 settings.json changed ${lost.length} value(s) the user had set: ` +
        `${lost.join('; ')}. FR-051: an upgrade loses nothing.`,
    ).toEqual([]);
  });

  it('gives the three new keys their shipped defaults, not undefined', () => {
    /*
     * All three ship ON (FR-030, FR-031, FR-040), so `undefined` and `false` are both wrong and
     * only one of them looks wrong. `toBe(true)` rather than `toBeTruthy()` deliberately: the
     * failure this is guarding is a missing value, and `toBeTruthy` on `undefined` and `toBe(true)`
     * on `undefined` fail differently only in what they say afterwards.
     */
    const parsed = parseAppSettings(preFeatureDocument());
    expect(parsed.editor.showGutter).toBe(true);
    expect(parsed.editor.statusBar.showCursorPosition).toBe(true);
    expect(parsed.editor.statusBar.showCounts).toBe(true);
    for (const leaf of NEW_LEAVES) {
      expect(getAtPath(parsed, leaf), `${leaf} came back as undefined`).toBe(
        getAtPath(DEFAULT_APP_SETTINGS, leaf),
      );
    }
  });

  it('adds nothing to the document except those three keys', () => {
    /*
     * SC-007's other half — "nothing to reconfigure". If reading an old file materialised some
     * FOURTH key, this feature would be changing more of a user's configuration than it declared,
     * and the three-key story in the spec would be wrong.
     *
     * Self-maintaining in the same way as the sweep above: a later feature that adds a key has to
     * come back here and say so.
     */
    const doc = preFeatureDocument();
    const parsed = parseAppSettings(doc);
    const before = new Set(leavesOf(doc));
    const added = leavesOf(parsed).filter((leaf) => !before.has(leaf));
    expect(added.sort()).toEqual([...NEW_LEAVES].sort());
  });

  it('survives a whole missing editor section, not just the new keys', () => {
    /*
     * The oldest documents in the wild are the smallest ones. A file written before the editor had
     * any settings at all has no `editor` key whatsoever, and the section must still come back
     * fully formed — including the nested `statusBar` object, which is the one a shallow fallback
     * would leave undefined.
     */
    const parsed = parseAppSettings({ appearance: { theme: 'Matrix' } });
    expect(parsed.appearance.theme).toBe('Matrix');
    expect(parsed.editor).toEqual(DEFAULT_APP_SETTINGS.editor);
    expect(parsed.editor.statusBar).toEqual(DEFAULT_APP_SETTINGS.editor.statusBar);
  });

  it('keeps a partial statusBar section — one stated key does not default the other', () => {
    /*
     * The half-upgraded document: a user who edited `settings.json` by hand, or a file written by
     * a build where only one of the pair existed. `statusBarSettings` is a per-FIELD tolerant parse
     * for exactly this reason, and a whole-object fallback (`isRecord(v) ? v : fallback` applied to
     * the section) would throw the stated value away.
     */
    const doc = preFeatureDocument();
    (doc.editor as Doc).statusBar = { showCounts: false };
    const parsed = parseAppSettings(doc);
    expect(parsed.editor.statusBar.showCounts).toBe(false);
    expect(parsed.editor.statusBar.showCursorPosition).toBe(true);
  });
});
