/**
 * The three status-bar settings, their copy, and the grouping they arrive in (040 US3).
 *
 * ══ WHY THE UNIT TIER ══
 *
 * Every claim here is a fact about two pure registries — `DEFAULT_APP_SETTINGS` and
 * `SETTINGS_METADATA`. A key exists, a default is `true`, a descriptor carries a subgroup, a
 * sentence names five things. None of it needs a DOM, and asserting it anywhere more expensive
 * would be paying for a window to read a constant.
 *
 * What is NOT here: that the toggles RENDER (FR-053). A descriptor existing and a row appearing are
 * different claims — `settings-tab-subgroups.test.ts` owns the second, at the component tier.
 *
 * ══ THE ONE TRAP IN FR-034a ══
 *
 * "All user-facing copy says status bar, never status strip" is a claim about the VALUES a user
 * reads — `label` and `description` — not about the source file. So the sweep below walks
 * descriptors, not bytes.
 *
 * An earlier version of this comment justified that by claiming `settings-metadata.ts` carried
 * "eighteen other 'status strip' mentions in comments and JSDoc". **That number was invented.** The
 * file contains exactly ONE occurrence, and it is a comment this feature added — on master the
 * single occurrence was the description string this feature rewrote. So a byte sweep would in fact
 * pass today.
 *
 * The conclusion survives its false premise: FR-034a governs what a user reads, and a sweep over
 * source text would start failing the moment somebody writes "status strip" in a comment about
 * 016's original naming — which is legitimate prose about a shipped requirement. Walking descriptors
 * is right because of what the requirement says, not because of a count nobody checked.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA, settingsLeaves } from '../../src/config/settings-metadata.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
import type { FieldDescriptor } from '../../src/config/metadata.js';

const CURSOR_KEY = 'editor.statusBar.showCursorPosition';
const COUNTS_KEY = 'editor.statusBar.showCounts';
const BAR_KEY = 'editor.showStatusBar';
const TERMINAL_BAR_KEY = 'terminals.showStatusBar';

const descriptor = (key: string): FieldDescriptor => {
  const found = SETTINGS_METADATA.find((d) => d.key === key);
  expect(found, `no descriptor for ${key}`).toBeDefined();
  return found as FieldDescriptor;
};

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-030 / FR-031 — the two keys exist, are boolean, and ship ON
 * ────────────────────────────────────────────────────────────────────────── */

describe('the two readout toggles (FR-030, FR-031)', () => {
  it('ships editor.statusBar.showCursorPosition as a boolean defaulting to true', () => {
    expect(DEFAULT_APP_SETTINGS.editor.statusBar.showCursorPosition).toBe(true);
    expect(typeof DEFAULT_APP_SETTINGS.editor.statusBar.showCursorPosition).toBe('boolean');
  });

  it('ships editor.statusBar.showCounts as a boolean defaulting to true', () => {
    expect(DEFAULT_APP_SETTINGS.editor.statusBar.showCounts).toBe(true);
    expect(typeof DEFAULT_APP_SETTINGS.editor.statusBar.showCounts).toBe('boolean');
  });

  it('describes both as toggles, so the visual editor can reach them (FR-050)', () => {
    expect(descriptor(CURSOR_KEY).control).toBe('toggle');
    expect(descriptor(COUNTS_KEY).control).toBe('toggle');
  });

  it('counts both as configurable leaves, not internal bookkeeping', () => {
    const leaves = settingsLeaves();
    expect(leaves).toContain(CURSOR_KEY);
    expect(leaves).toContain(COUNTS_KEY);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-032 — exactly TWO readout toggles, not one per figure
 * ────────────────────────────────────────────────────────────────────────── */

describe('the readout toggles are two, not five (FR-032)', () => {
  it('declares exactly two keys under editor.statusBar', () => {
    // The whole of the sub-object, so a per-figure toggle added later fails HERE rather than
    // shipping a combinatorial surface nobody asked for.
    expect(Object.keys(DEFAULT_APP_SETTINGS.editor.statusBar).sort()).toEqual([
      'showCounts',
      'showCursorPosition',
    ]);
  });

  it('declares exactly two editor.statusBar.* descriptors', () => {
    const keys = SETTINGS_METADATA.filter((d) => d.key.startsWith('editor.statusBar.')).map(
      (d) => d.key,
    );
    expect(keys.sort()).toEqual([COUNTS_KEY, CURSOR_KEY].sort());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-034 — the description is an explanation, not an inventory
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.showStatusBar says what the bar holds and what hiding it does (FR-034)', () => {
  it('names the language control, the wrap toggle, the caret position and the counts', () => {
    const text = descriptor(BAR_KEY).description.toLowerCase();
    expect(text, 'the language control').toContain('language');
    expect(text, 'the wrap toggle').toContain('wrap');
    expect(text, 'the caret position').toMatch(/cursor|caret|line and column/);
    expect(text, 'the character count').toContain('character');
    expect(text, 'the word count').toContain('word count');
  });

  it('states that hiding the bar overrides the individual settings', () => {
    const text = descriptor(BAR_KEY).description.toLowerCase();
    // The requirement is that the sentence exists, not its wording: hiding must be said to beat
    // whatever the other two say. Without this the user reads two toggles that appear to disagree
    // with a third and has no way to know which wins.
    expect(text).toMatch(/hid(e|ing|den)/);
    expect(text).toMatch(/whatever|regardless|no matter|even if|overrid/);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-034a — the prose calls it a status BAR
 * ────────────────────────────────────────────────────────────────────────── */

describe('no user-facing string calls it a status strip (FR-034a)', () => {
  it('finds "status strip" in no label and no description in the whole registry', () => {
    const offenders = SETTINGS_METADATA.filter(
      (d) => /status\s+strip/i.test(d.label) || /status\s+strip/i.test(d.description),
    ).map((d) => d.key);
    expect(offenders, 'these say "status strip" to the user').toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-037 / FR-038 — where the three of them appear, and where one does not
 * ────────────────────────────────────────────────────────────────────────── */

describe('the three status-bar settings sit together under Editor → Status Bar (FR-037)', () => {
  it('groups all three under Editor with the subgroup Status Bar', () => {
    for (const key of [BAR_KEY, CURSOR_KEY, COUNTS_KEY]) {
      expect(descriptor(key).group, key).toBe('Editor');
      expect(descriptor(key).subgroup, key).toBe('Status Bar');
    }
  });

  it('declares the parent BEFORE the two it governs, because its copy says "the two below"', () => {
    /*
     * `editor.showStatusBar`'s description ends "…whatever the two settings below say". That is a
     * POSITIONAL claim about the rendered form, and FR-036a makes declaration order the rendering
     * order — so the sentence is true only for as long as these three descriptors stay in this
     * order in `settings-metadata.ts`.
     *
     * Nothing pinned it. Moving the `showStatusBar` block beneath its two neighbours leaves every
     * other assertion in this file green — the keys, the defaults, the group, the subgroup and the
     * copy sweep are all order-blind — while the form shows a control saying "the two settings
     * below" printed UNDERNEATH both of them. A user reading that has no way to tell which two are
     * meant.
     *
     * Asserted as an ordering rather than as three indices, so it stays true when a fourth Editor
     * setting is added between groups.
     */
    const index = (key: string): number => SETTINGS_METADATA.findIndex((d) => d.key === key);
    expect(index(BAR_KEY), BAR_KEY).toBeGreaterThan(-1);
    expect(index(BAR_KEY), `${BAR_KEY} before ${CURSOR_KEY}`).toBeLessThan(index(CURSOR_KEY));
    expect(index(CURSOR_KEY), `${CURSOR_KEY} before ${COUNTS_KEY}`).toBeLessThan(index(COUNTS_KEY));
  });

  it('moves no other Editor setting into a subsection', () => {
    // FR-037's second sentence. Every other `Editor` descriptor stays flat — a setting that
    // acquired a subgroup here would have moved without anyone asking.
    const strays = SETTINGS_METADATA.filter(
      (d) =>
        d.group === 'Editor' &&
        d.subgroup !== undefined &&
        d.key !== BAR_KEY &&
        d.key !== CURSOR_KEY &&
        d.key !== COUNTS_KEY,
    ).map((d) => d.key);
    expect(strays).toEqual([]);
  });

  it('leaves terminals.showStatusBar directly under Terminal, in no subsection (FR-038)', () => {
    expect(descriptor(TERMINAL_BAR_KEY).group).toBe('Terminal');
    expect(descriptor(TERMINAL_BAR_KEY).subgroup).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-037a — the shipped sibling-string groups do not move
 * ────────────────────────────────────────────────────────────────────────── */

describe('the shipped sibling-string sub-groups are left exactly as they are (FR-037a)', () => {
  it('still declares the same three "Editor · …" group strings, and no more', () => {
    /*
     * A MUST that nothing else asserts. This feature adds a SECOND sub-grouping mechanism
     * (`subgroup`) beside the sibling-string one, and the decision recorded in FR-037a is that the
     * existing three are not migrated onto it. The failure this guards is the tempting one: a
     * later sweep turns `Editor · Navigation` into `Editor` + `subgroup: 'Navigation'` and every
     * user's mental map of the form changes with no requirement asking for it.
     */
    const siblings = [...new Set(SETTINGS_METADATA.map((d) => d.group))]
      .filter((g) => g.startsWith('Editor ·'))
      .sort();
    expect(siblings).toEqual(['Editor · Indentation', 'Editor · Languages', 'Editor · Navigation']);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-039 — nothing is renamed, re-typed or re-defaulted
 * ────────────────────────────────────────────────────────────────────────── */

describe('no key, default or control type changed (FR-039)', () => {
  it('leaves editor.showStatusBar a toggle that ships on', () => {
    expect(DEFAULT_APP_SETTINGS.editor.showStatusBar).toBe(true);
    expect(descriptor(BAR_KEY).control).toBe('toggle');
    // Its LABEL is user-facing copy this feature does not rewrite — only the description is.
    expect(descriptor(BAR_KEY).label).toBe('Show editor status bar');
  });

  it('leaves terminals.showStatusBar a toggle that ships on', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.showStatusBar).toBe(true);
    expect(descriptor(TERMINAL_BAR_KEY).control).toBe('toggle');
  });

  it('adds the two new keys and renames nothing — every pre-040 editor key survives', () => {
    // The keys a rename would silently reset. Listed rather than snapshotted, because a snapshot
    // updated by the same hand that broke it proves nothing.
    for (const key of [
      'editor.openOnClick',
      'editor.openTarget',
      'editor.autoSave',
      'editor.saveDocumentScroll',
      'editor.autoSaveDebounceMs',
      'editor.saveAllScope',
      'editor.defaultLineEnding',
      'editor.maxOpenFileBytes',
      'editor.projectPathDisplay',
      'editor.subWorkspacePathDisplay',
      'editor.warnOnMissingFile',
      'editor.persistUndoHistory',
      'editor.defaultWordWrap',
      'editor.showStatusBar',
      'editor.navigation.quickOpenExcludeHidden',
      'editor.navigation.rememberQuickOpenQuery',
      'editor.navigation.rememberGotoLineNumber',
    ]) {
      expect(settingsLeaves(), key).toContain(key);
    }
  });
});
