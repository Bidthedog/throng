import { describe, it, expect } from 'vitest';
import {
  SETTINGS_METADATA,
  SETTINGS_INTERNAL_KEYS,
  HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS,
  settingsLeaves,
} from '../../src/config/settings-metadata.js';
import {
  assertEveryKeyDescribed,
  auditRegistry,
  leavesOf,
  leavesOfDeclared,
} from '../../src/config/metadata.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
} from '../../src/notice/display-mode.js';

describe('SETTINGS_METADATA completeness (FR-047)', () => {
  it('describes every configurable settings leaf and no unknown keys', () => {
    const keys = settingsLeaves();
    expect(() => assertEveryKeyDescribed(keys, SETTINGS_METADATA)).not.toThrow();
    // no missing/unknown/duplicated
    expect(auditRegistry(keys, SETTINGS_METADATA)).toEqual({
      missing: [],
      unknown: [],
      duplicated: [],
    });
  });

  it('excludes only the internal version marker from the configurable set', () => {
    // A declared MAP is ONE leaf (016, F5). Its rows are the user's DATA — `.foo` → Python, Go →
    // tabs — not fields of the settings schema, so they cannot each carry a descriptor. Walking
    // into them would demand one for `editor.indentByLanguage.csharp.style`, and a new row a user
    // added at runtime would make their own configuration fail its own completeness check.
    const allLeaves = leavesOfDeclared(DEFAULT_APP_SETTINGS, SETTINGS_METADATA);
    const configurable = settingsLeaves();
    expect(leavesOf(DEFAULT_APP_SETTINGS)).toContain('version');
    expect(configurable).not.toContain('version');
    // Every non-internal leaf is configurable.
    for (const leaf of allLeaves) {
      if (!SETTINGS_INTERNAL_KEYS.includes(leaf)) expect(configurable).toContain(leaf);
    }
    // …and the maps are leaves in their own right, not doors into the user's rows.
    expect(allLeaves).toContain('editor.indentByLanguage');
    expect(allLeaves).not.toContain('editor.indentByLanguage.csharp.style');
  });

  it('has unique descriptor keys', () => {
    const seen = new Set<string>();
    for (const d of SETTINGS_METADATA) {
      expect(seen.has(d.key), `duplicate ${d.key}`).toBe(false);
      seen.add(d.key);
    }
  });
});

describe('SETTINGS_METADATA control types (FR-028/029)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  it('enumerated leaves are a constrained select with the right allowed values', () => {
    const confirm = byKey.get('confirmations.destroyProject');
    expect(confirm?.control).toBe('select');
    expect(confirm?.allowedValues).toEqual(['none', 'single', 'double']);

    expect(byKey.get('editor.openOnClick')?.allowedValues).toEqual(['single', 'double', 'none']);
    expect(byKey.get('explorer.deleteMode')?.allowedValues).toEqual(['recycle', 'permanent']);
    expect(byKey.get('explorer.dragCopyModifier')?.allowedValues).toEqual(['ctrl', 'shift', 'alt']);
    expect(byKey.get('editor.saveAllScope')?.allowedValues).toEqual(['tab', 'project', 'all']);
    expect(byKey.get('editor.defaultLineEnding')?.allowedValues).toEqual(['lf', 'crlf', 'cr']);
  });

  /*
   * A LABEL OVERRIDE THAT MISSES A VALUE IS WORSE THAN NONE AT ALL.
   *
   * The renderer falls back per-value, so a partial map produces a dropdown in two registers at
   * once — "Never display", "Display for", "Dismiss" — which reads as a bug in one of the three
   * rather than an omission in the descriptor. Whole set or nothing.
   */
  it('every descriptor that renames its options renames all of them, and no others', () => {
    for (const d of SETTINGS_METADATA) {
      if (!d.optionLabels) continue;
      expect(d.allowedValues, `${d.key} renames options it does not declare`).toBeDefined();
      expect(Object.keys(d.optionLabels).sort(), d.key).toEqual(
        d.allowedValues!.map(String).sort(),
      );
    }
  });

  it('every descriptor with allowedValues uses a choice control, never text', () => {
    for (const d of SETTINGS_METADATA) {
      if (d.allowedValues) {
        expect(['select', 'multiselect', 'enum'], d.key).toContain(d.control);
      }
    }
  });

  it('matches control to value type', () => {
    expect(byKey.get('editor.autoSave')?.control).toBe('toggle');
    expect(byKey.get('editor.warnOnMissingFile')?.control).toBe('toggle');
    // 024 US1 — three new boolean toggles, grouped by surface.
    expect(byKey.get('editor.defaultWordWrap')?.control).toBe('toggle');
    expect(byKey.get('editor.defaultWordWrap')?.group).toBe('Editor');
    expect(byKey.get('editor.showStatusBar')?.control).toBe('toggle');
    expect(byKey.get('editor.showStatusBar')?.group).toBe('Editor');
    expect(byKey.get('terminals.showStatusBar')?.control).toBe('toggle');
    expect(byKey.get('terminals.showStatusBar')?.group).toBe('Terminal');
    expect(byKey.get('panes.projects.maxWidth')?.control).toBe('slider'); // 018: a bounded numeric is DRAGGABLE now (FR-032)
    expect(byKey.get('behaviour.tabHoverActivateMs')?.control).toBe('slider');
    // A slider now, in 5 MB steps: the objection to it was about the RANGE, and the STEP answers it.
    expect(byKey.get('editor.maxOpenFileBytes')?.control).toBe('slider');
    // string arrays → array
    expect(byKey.get('explorer.excludeGlobs')?.control).toBe('array');
    // The three terminal-flavour controls are HIDDEN for v1.0.0 (see the dedicated block below):
    // they are no longer in the rendered registry, so `byKey` does not carry them. Their control
    // shapes are asserted against HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS instead.
  });

  it('groups every descriptor into a labelled section', () => {
    for (const d of SETTINGS_METADATA) {
      expect(d.group.length, d.key).toBeGreaterThan(0);
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.description.length, d.key).toBeGreaterThan(0);
    }
  });
});

describe('SETTINGS_METADATA notification leaves (030 US1, #224)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

  /*
   * The COUNT is not asserted here — the completeness block above already does it, from the leaves
   * of DEFAULT_APP_SETTINGS. Eight new leaves without eight descriptors fails there, and a ninth
   * descriptor for a leaf that does not exist fails there too. What that cannot see is whether the
   * bounds a descriptor declares are the bounds the parser enforces: a control that let you commit
   * 500 ms into a setting the parser then silently replaced with the default is issue #227's defect,
   * and it is invisible to any completeness rule.
   */
  it('describes both leaves of all four severities', () => {
    for (const severity of SEVERITIES) {
      expect(byKey.has(`notifications.${severity}.mode`), severity).toBe(true);
      expect(byKey.has(`notifications.${severity}.timeoutMs`), severity).toBe(true);
    }
  });

  it('offers exactly the three display modes, as a constrained choice', () => {
    for (const severity of SEVERITIES) {
      const d = byKey.get(`notifications.${severity}.mode`);
      expect(d?.control, severity).toBe('select');
      expect(d?.allowedValues, severity).toEqual(['never', 'timed', 'dismiss']);
    }
  });

  /*
   * FR-001's THREE NAMES, on the control itself.
   *
   * The stored values are machine tokens, and the generic Title-Case fallback turns them into
   * "Never", "Timed" and "Dismiss" — three words the specification never uses, one of which
   * ("Dismiss") reads as a button that would dismiss something rather than a mode. The names FR-001
   * gives are the ones the user is asked about in the FR-008 confirmation and the ones every issue
   * comment uses, so the dropdown has to say them.
   */
  it('names the three modes as FR-001 does, not as the token fallback would', () => {
    for (const severity of SEVERITIES) {
      const d = byKey.get(`notifications.${severity}.mode`);
      expect(d?.optionLabels, severity).toEqual({
        never: 'Never display',
        timed: 'Display for',
        dismiss: 'Dismiss only',
      });
    }
  });

  it('bounds every timeout at the values the parser enforces (3000–30000)', () => {
    // Read from the notice module rather than retyped: a descriptor whose bounds drift from the
    // clamp is the bug, so the test must not carry its own copy of either number.
    for (const severity of SEVERITIES) {
      const d = byKey.get(`notifications.${severity}.timeoutMs`);
      expect(d?.min, severity).toBe(TIMEOUT_MIN_MS);
      expect(d?.max, severity).toBe(TIMEOUT_MAX_MS);
      expect(d?.min, severity).toBe(3000);
      expect(d?.max, severity).toBe(30000);
      expect(d?.step, severity).toBe(500);
    }
  });

  /*
   * THE SHIPPED DEFAULTS ARE REACHABLE BY DRAGGING — which is what the bounds change bought.
   *
   * Under the old 1500–60000 range a step of 500 was illegal (the slider guard wants at least 1% of
   * a 58500 range, i.e. 585) and the smallest legal step, 750, put 5000 and 10000 BETWEEN two stops:
   * a user who dragged the thumb could never get back to the value their app shipped with, and the
   * only route home was Reset or hand-editing JSON. 3000–30000 makes 1% equal 270, so 500 is legal,
   * and every shipped default sits exactly on the grid.
   */
  it('puts every shipped default on the slider grid, so a drag can return to it', () => {
    for (const severity of SEVERITIES) {
      const d = byKey.get(`notifications.${severity}.timeoutMs`)!;
      const shipped = DEFAULT_NOTIFICATION_SETTINGS[severity].timeoutMs;
      expect(shipped, severity).toBeGreaterThanOrEqual(d.min!);
      expect(shipped, severity).toBeLessThanOrEqual(d.max!);
      expect(
        (shipped - d.min!) % d.step!,
        `${severity}: the shipped ${shipped} ms is between two stops of a ${d.step} ms slider`,
      ).toBe(0);
    }
  });

  it('groups all eight under Notifications, so they arrive as one section', () => {
    const notifications = SETTINGS_METADATA.filter((d) => d.key.startsWith('notifications.'));
    expect(notifications).toHaveLength(8);
    for (const d of notifications) expect(d.group, d.key).toBe('Notifications');
  });
});

describe('terminal-flavour controls are HIDDEN for v1.0.0 (#67 → vNext)', () => {
  const rendered = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const hidden = new Map(HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS.map((d) => [d.key, d]));
  const HIDDEN_KEYS = [
    'terminals.flavours',
    'terminals.disabledBuiltins',
    'terminals.defaultShellArguments',
  ] as const;

  it('classifies all three as internal, so they are not in the configurable set', () => {
    for (const key of HIDDEN_KEYS) {
      expect(SETTINGS_INTERNAL_KEYS, key).toContain(key);
      expect(settingsLeaves(), key).not.toContain(key);
    }
  });

  it('does not render them: no descriptor in the rendered SETTINGS_METADATA', () => {
    for (const key of HIDDEN_KEYS) {
      expect(rendered.has(key), key).toBe(false);
    }
  });

  it('keeps their descriptors intact for vNext re-exposure (a hide, not a revert)', () => {
    // The controls are withheld, not deleted — vNext re-exposes them by spreading this array back
    // into SETTINGS_METADATA. Assert the shapes survive so a stray deletion is caught here.
    expect(hidden.get('terminals.flavours')?.control).toBe('records');
    expect(hidden.get('terminals.flavours')?.idKey).toBe('id');
    expect(hidden.get('terminals.disabledBuiltins')?.control).toBe('multiselect');
    expect(hidden.get('terminals.defaultShellArguments')?.control).toBe('map');
  });
});

describe('SETTINGS_METADATA new-project + verb changes (011)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  it('describes the starting-folder choice as a select', () => {
    const d = byKey.get('newProject.startingFolder');
    expect(d?.control).toBe('select');
    expect(d?.allowedValues).toEqual(['profile', 'lastViewed', 'override']);
  });

  it('describes the override path with the folder control', () => {
    expect(byKey.get('newProject.overridePath')?.control).toBe('folder');
  });

  it('treats lastProjectFolder as internal (no descriptor, not configurable)', () => {
    expect(SETTINGS_INTERNAL_KEYS).toContain('newProject.lastProjectFolder');
    expect(byKey.has('newProject.lastProjectFolder')).toBe(false);
    expect(settingsLeaves()).not.toContain('newProject.lastProjectFolder');
  });

  it('re-aligns the confirmation labels to the new verbs (keys unchanged)', () => {
    expect(byKey.get('confirmations.destroyProject')?.label).toBe('Remove a project');
    expect(byKey.get('confirmations.destroySubWorkspace')?.label).toBe('Destroy a sub-workspace');
  });

  it('speaks one destructive vocabulary across the whole confirmation group (#329)', () => {
    // A tab takes its panels with it, and the dialogs governing that already say so —
    // `tab-group.tsx` uses `Destroy Tab` for one and `Destroy tabs` for several. The label on the
    // control deciding how hard that is to do said "Close", which is the verb for something cheap
    // and reversible. The KEY has read `destroyTab` since it was written; only the copy lagged.
    expect(byKey.get('confirmations.destroyTab')?.label).toBe('Destroy a tab');
    expect(byKey.get('confirmations.destroyTab')?.description).toBe(
      'How many confirmations before a tab (with its panels) is destroyed.',
    );
    expect(byKey.get('confirmations.destroyPanel')?.label).toBe('Destroy a panel');

    // Nothing in the group softens the verb. Project is the one legitimate exception: removing a
    // project unregisters it and deletes no files, so "Remove" is accurate rather than soft.
    const softened = [...byKey.entries()]
      .filter(([key]) => key.startsWith('confirmations.'))
      .filter(([, d]) => /\bclos(e|ed|ing)\b/i.test(`${d.label} ${d.description ?? ''}`));
    expect(softened.map(([key]) => key)).toEqual([]);
  });
});


/**
 * 043 T168 — the shipped defaults (FR-074, FR-075) and the section split (FR-076).
 *
 * ══ WHY THE DEFAULTS ARE ASSERTED HERE AND NOT ONLY IN `app-settings.test.ts` ══
 *
 * Because a default is carried by the SCHEMA as well as by the constant, and the two can disagree
 * silently. FR-075 moves `settleMs` onto a slider whose stops are 50 ms apart: a shipped value
 * BETWEEN two stops is reachable only by typing, so a user who drags the control can never get back
 * to what the application shipped with. That is a property of the constant and the descriptor
 * TOGETHER, and neither file's own tests can see it.
 *
 * ══ FR-076: A SECTION OF THEIR OWN ══
 *
 * The seven leaves shipped in one `Search` group, on the argument that a user asking "how do I make
 * searching behave" should find them in one place. FR-076 decides the opposite question the same
 * way the editor's preferences already answer it — `Editor · Indentation` and `Editor · Navigation`
 * are sub-sections of `Editor`, not one flat list — so the find bar's one key and Find in Files'
 * eight (six at FR-076, and the two FR-082 adds — the replace summary notice's own display mode and
 * its own timeout) are separated, and a setting appears in both only if it genuinely governs both.
 * None does: the settle interval was deliberately NOT made a second use of the find bar's debounce
 * (FR-043b), and
 * `settings-inertness-043.test.ts` is what stops that decision being quietly undone.
 */
describe('Find in Files ships as-you-type at 500 ms, in its own section (FR-074/075/076)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  const FIND_IN_FILES_KEYS = [
    'search.inFiles.openTarget',
    'search.inFiles.trigger',
    'search.inFiles.settleMs',
    'search.inFiles.defaultGrouping',
    'search.inFiles.rememberGrouping',
    'search.inFiles.warnIrreversibleCommit',
    // The two FR-082 adds. Listed HERE rather than only in their own describe below, because this
    // array is what holds the section membership for the whole family: a ninth key added to
    // `search.inFiles` and left out of this list is a row rendered under a heading nobody checked.
    'search.inFiles.summaryNoticeMode',
    'search.inFiles.summaryNoticeTimeoutMs',
  ];

  it('starts a scan as the user types, by default (FR-074)', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.trigger).toBe('asYouType');
    // Still a preference, and still a closed set of two — FR-074 moves the default, not the model.
    expect(byKey.get('search.inFiles.trigger')?.allowedValues).toEqual(['run', 'asYouType']);
  });

  it('waits 500 ms for typing to settle (FR-075)', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.settleMs).toBe(500);
  });

  it('leaves the find bar’s own debounce where it was — the two keys are deliberately distinct', () => {
    // FR-075 moves this one interval and no other. 120 ms times a re-scan of ONE buffer already in
    // memory; 500 ms gates a walk over the whole project.
    expect(DEFAULT_APP_SETTINGS.search.asYouTypeDebounceMs).toBe(120);
  });

  it('puts the shipped 500 exactly on a slider stop, so a drag can always return to it', () => {
    const d = byKey.get('search.inFiles.settleMs');
    expect(d?.control).toBe('slider');
    expect(d?.min).toBe(0);
    expect(d?.max).toBe(2000);
    expect(d?.step).toBe(50);
    const shipped = DEFAULT_APP_SETTINGS.search.inFiles.settleMs;
    expect(shipped).toBeGreaterThanOrEqual(d!.min!);
    expect(shipped).toBeLessThanOrEqual(d!.max!);
    expect(
      (shipped - d!.min!) % d!.step!,
      'a shipped value between two stops is unreachable by dragging',
    ).toBe(0);
  });

  it('gives Find in Files a section of its own (FR-076)', () => {
    for (const key of FIND_IN_FILES_KEYS) {
      expect(byKey.get(key)?.group, key).toBe('Search · Find in Files');
    }
  });

  it('leaves the find bar’s delay in a section of its own (FR-076)', () => {
    expect(byKey.get('search.asYouTypeDebounceMs')?.group).toBe('Search · Find Bar');
  });

  it('leaves no descriptor in the undivided "Search" group', () => {
    // The half a rename is likeliest to leave behind: one key still pointing at the old group name
    // renders a third section holding a single orphan, and nothing else in the suite would say so.
    const orphans = SETTINGS_METADATA.filter((d) => d.group === 'Search').map((d) => d.key);
    expect(orphans).toEqual([]);
  });

  it('names both sub-sections after the parent, so a search for "search" still returns both', () => {
    // 021 FR-015 matches a field by its GROUP as a substring, which is the whole reason the editor's
    // sub-sections are spelled "Editor · Navigation" rather than "Navigation". Splitting the section
    // must not cost the user the one query that used to reach every one of these keys.
    const groups = new Set(
      SETTINGS_METADATA.map((d) => d.group).filter((g) => g.startsWith('Search')),
    );
    expect([...groups].sort()).toEqual(['Search · Find Bar', 'Search · Find in Files']);
    for (const g of groups) expect(g.toLowerCase()).toContain('search');
  });
});

/**
 * 043 T199 — the replace summary notice gets a display mode and a duration OF ITS OWN (FR-082).
 *
 * ══ WHY THESE TWO ARE NOT `notifications.*` KEYS ══
 *
 * Because they govern ONE notice rather than a severity. FR-082 states the cost of that in as many
 * words: for this notice the global `notifications.*` settings are not consulted at all, so a user
 * whose global preference is that errors stay until dismissed does not get that behaviour here. That
 * is a deliberate override, and the pair therefore belongs in this feature's own section — a
 * preference that governs only Find in Files, in the group named after it (FR-076).
 *
 * ══ WHAT IS ASSERTED, AND WHY EACH ONE ══
 *
 *  - The application's EXISTING display vocabulary, not a parallel one. `allowedValues` is
 *    `DISPLAY_MODES` itself and `optionLabels` is `DISPLAY_MODE_LABELS` itself — identity, not
 *    equality, because a copied array is exactly how a fourth mode comes to exist in one dropdown
 *    and not the other.
 *  - The bounds are `TIMEOUT_MIN_MS`/`TIMEOUT_MAX_MS`, for #227's reason: a descriptor whose bounds
 *    disagree with the parse's clamp ships a control offering values the parser silently replaces.
 *  - The shipped default sits exactly ON a slider stop. That is RE-DERIVED here from the shipped
 *    constants rather than taken on trust from the 5000 that `notifications.*` already ships: a
 *    value between two stops is reachable only by typing, so a user who drags the control can never
 *    get back to what the application came with, and this repository has been bitten by it once
 *    already (the reasoning at `display-mode.ts:44-60`).
 *
 * ══ THE DEFAULT IS NOT SELF-CONTRADICTORY ══
 *
 * `dismiss` with a 5000 ms timeout is what `error` and `warning` already ship. A timeout is stored
 * for every severity whatever its mode — so switching to *Display for* never presents an empty
 * control — and it is consulted only under `timed`. A stored 5000 under `dismiss` is a value waiting
 * to become meaningful.
 */
describe('the replace summary notice has a display mode and a duration of its own (FR-082)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const MODE_KEY = 'search.inFiles.summaryNoticeMode';
  const TIMEOUT_KEY = 'search.inFiles.summaryNoticeTimeoutMs';

  it('offers the three modes the rest of the application offers, under their own names', () => {
    const d = byKey.get(MODE_KEY);
    expect(d, `${MODE_KEY} has no descriptor`).toBeDefined();
    expect(d?.control).toBe('select');
    // Identity: the constant itself, so a fourth mode cannot reach one dropdown and miss this one.
    expect(d?.allowedValues).toBe(DISPLAY_MODES);
    expect(d?.optionLabels).toBe(DISPLAY_MODE_LABELS);
  });

  it('bounds the duration exactly as the parse does, on a slider (FR-082, #227)', () => {
    const d = byKey.get(TIMEOUT_KEY);
    expect(d, `${TIMEOUT_KEY} has no descriptor`).toBeDefined();
    expect(d?.control).toBe('slider');
    expect(d?.min).toBe(TIMEOUT_MIN_MS);
    expect(d?.max).toBe(TIMEOUT_MAX_MS);
    expect(d?.step).toBe(500);
  });

  it('ships dismiss / 5000 ms — and the 5000 lands ON a stop, re-derived', () => {
    const shipped = DEFAULT_APP_SETTINGS.search.inFiles;
    expect(shipped.summaryNoticeMode).toBe('dismiss');
    expect(shipped.summaryNoticeTimeoutMs).toBe(5000);

    const d = byKey.get(TIMEOUT_KEY);
    expect(shipped.summaryNoticeTimeoutMs).toBeGreaterThanOrEqual(d!.min!);
    expect(shipped.summaryNoticeTimeoutMs).toBeLessThanOrEqual(d!.max!);
    expect(
      (shipped.summaryNoticeTimeoutMs - d!.min!) % d!.step!,
      'a shipped value between two stops is unreachable by dragging',
    ).toBe(0);
  });

  it('keeps both OUT of the Notifications section (FR-076)', () => {
    // The section membership itself is asserted once, over the whole eight, by
    // `FIND_IN_FILES_KEYS` above. This is the other half of that claim and the one a reader is
    // likeliest to get wrong: a mode-and-timeout pair looks like it belongs beside the four
    // severities, and putting it there would tell the user it governs them.
    for (const key of [MODE_KEY, TIMEOUT_KEY]) {
      expect(byKey.get(key)?.group, key).not.toBe('Notifications');
    }
  });

  it('leaves the four global severities exactly as they were — this overrides nothing else', () => {
    // The discriminating half. FR-082 takes the global settings out of the loop for ONE notice; a
    // change that reached `notifications.*` would be a far larger one than the requirement asks for.
    expect(DEFAULT_NOTIFICATION_SETTINGS.error).toEqual({ mode: 'dismiss', timeoutMs: 5000 });
    expect(DEFAULT_NOTIFICATION_SETTINGS.warning).toEqual({ mode: 'dismiss', timeoutMs: 5000 });
    expect(DEFAULT_NOTIFICATION_SETTINGS.info).toEqual({ mode: 'timed', timeoutMs: 10000 });
    expect(DEFAULT_NOTIFICATION_SETTINGS.success).toEqual({ mode: 'timed', timeoutMs: 5000 });
  });
});
