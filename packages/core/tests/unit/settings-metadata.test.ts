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
  PANEL_LIMIT_MAX,
  PANEL_LIMIT_MIN,
  TOAST_DURATION_MAX_MS,
  TOAST_DURATION_MIN_MS,
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
      invalidNesting: [],
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
    // 059 FR-060 — the View Whitespace default sits beside the wrap default.
    expect(byKey.get('editor.defaultShowWhitespace')?.control).toBe('toggle');
    expect(byKey.get('editor.defaultShowWhitespace')?.group).toBe('Editor');
    expect(byKey.get('editor.defaultShowWhitespace')?.subgroup).toBeUndefined();
    // 059 FR-067 — the hover names sit beside it.
    expect(byKey.get('editor.whitespaceHoverNames')?.control).toBe('toggle');
    expect(byKey.get('editor.whitespaceHoverNames')?.group).toBe('Editor');
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

describe('terminals.defaultRememberCommand description (068 US5, FR-051, FR-052)', () => {
  it('says a running Claude Code session is remembered as a resume of that session, and nothing about its view', () => {
    const d = SETTINGS_METADATA.find((x) => x.key === 'terminals.defaultRememberCommand');
    expect(d?.description).toMatch(/Claude Code session/);
    expect(d?.description).toMatch(/resume of that session/);
    expect(d?.description).not.toMatch(/restor|screen|conversation|scrollback|view/i);
  });
});

describe('SETTINGS_METADATA notification leaves (030 US1, #224; 068 US3)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const TYPES = ['error', 'warning', 'info', 'success', 'attention'] as const;

  it('describes the Toast, Panel and OS switches of every type, and no mode or per-type timeout (FR-021c, FR-092)', () => {
    for (const type of TYPES) {
      expect(byKey.has(`notifications.${type}.toast`), type).toBe(true);
      expect(byKey.has(`notifications.${type}.panel`), type).toBe(true);
      expect(byKey.has(`notifications.${type}.os`), type).toBe(true);
      expect(byKey.has(`notifications.${type}.mode`), type).toBe(false);
      expect(byKey.has(`notifications.${type}.timeoutMs`), type).toBe(false);
    }
  });

  it('draws Toast and Panel as checkboxes named Toast and Panel (FR-092)', () => {
    for (const type of TYPES) {
      expect(byKey.get(`notifications.${type}.toast`), type).toMatchObject({ control: 'toggle', label: 'Toast' });
      expect(byKey.get(`notifications.${type}.panel`), type).toMatchObject({ control: 'toggle', label: 'Panel' });
    }
  });

  it('asks before the last of Toast and Panel is cleared for error and warning only (030 FR-008, FR-092)', () => {
    for (const type of ['error', 'warning'] as const) {
      expect(byKey.get(`notifications.${type}.toast`)?.confirmWhen, type).toEqual({
        is: false,
        alsoWhen: { key: `notifications.${type}.panel`, is: false },
      });
      expect(byKey.get(`notifications.${type}.panel`)?.confirmWhen, type).toEqual({
        is: false,
        alsoWhen: { key: `notifications.${type}.toast`, is: false },
      });
    }
    for (const type of ['info', 'success', 'attention'] as const) {
      expect(byKey.get(`notifications.${type}.toast`)?.confirmWhen, type).toBeUndefined();
      expect(byKey.get(`notifications.${type}.panel`)?.confirmWhen, type).toBeUndefined();
    }
  });

  it('says that Panel keeps the notice in the Notifications panel until dismissed, with or without a toast', () => {
    for (const type of TYPES) {
      expect(byKey.get(`notifications.${type}.panel`)?.description, type).toMatch(
        /Notifications panel until (you )?dismiss.*with or without a toast/is,
      );
      expect(byKey.get(`notifications.${type}.toast`)?.description, type).toMatch(/with neither, it is shown nowhere/i);
    }
  });

  it('declares the toast duration as a 1000–30000 slider with a 500 ms step, and says what pauses it (FR-021c, FR-091)', () => {
    const d = byKey.get('notifications.toastDurationMs');
    expect(d).toMatchObject({ control: 'slider', min: TOAST_DURATION_MIN_MS, max: TOAST_DURATION_MAX_MS, step: 500, group: 'Notifications' });
    expect(d?.min).toBe(1000);
    expect(d?.max).toBe(30000);
    expect(d?.description).toMatch(/pointer is over it/i);
    expect(d?.description).toMatch(/keyboard focus is inside it/i);
    // The shipped default is on the grid, so a drag can return to it.
    expect((DEFAULT_NOTIFICATION_SETTINGS.toastDurationMs - d!.min!) % d!.step!).toBe(0);
  });

  it('declares the toast width as a 300–800 px slider on a 10 px step, in the Notifications group (FR-076, FR-090)', () => {
    const d = byKey.get('notifications.toastWidthPx');
    expect(d).toMatchObject({ control: 'slider', min: 300, max: 800, step: 10, group: 'Notifications' });
    expect(d?.description).toMatch(/half the window/i);
    // The shipped default is on the grid, so a drag can return to it, and the maximum is reachable.
    expect((DEFAULT_NOTIFICATION_SETTINGS.toastWidthPx - d!.min!) % d!.step!).toBe(0);
    expect((d!.max! - d!.min!) % d!.step!).toBe(0);
  });

  it('every type Toast description states the toast duration and the pointer/focus pause, with no stale wording (FR-032)', () => {
    for (const type of ['error', 'warning', 'info', 'success', 'attention']) {
      const text = byKey.get(`notifications.${type}.toast`)?.description ?? '';
      expect(text, type).toMatch(/leaves after the toast duration/i);
      expect(text, type).toMatch(/pointer is over it or focus is inside it/i);
      expect(text, type).not.toMatch(/shorten|Display for/i);
    }
  });

  it('labels the confirm switch as FR-026c names it', () => {
    expect(byKey.get('notifications.confirmDismissAll')?.label).toBe('Confirm before dismissing all notifications');
  });

  it('declares the confirm switch as a toggle and the panel limit as a 20–500 slider with a 10 step', () => {
    expect(byKey.get('notifications.confirmDismissAll')).toMatchObject({ control: 'toggle', group: 'Notifications' });
    const d = byKey.get('notifications.panelLimit');
    expect(d).toMatchObject({ control: 'slider', min: PANEL_LIMIT_MIN, max: PANEL_LIMIT_MAX, step: 10, group: 'Notifications' });
    expect(d?.min).toBe(20);
    expect(d?.max).toBe(500);
    expect(d?.description).toMatch(/oldest/i);
    expect(d?.description).toMatch(/warn/i);
    expect((DEFAULT_NOTIFICATION_SETTINGS.panelLimit - d!.min!) % d!.step!).toBe(0);
    expect((d!.max! - d!.min!) % d!.step!).toBe(0);
  });

  it('groups all twenty under Notifications, so they arrive as one section', () => {
    const notifications = SETTINGS_METADATA.filter((d) => d.key.startsWith('notifications.'));
    expect(notifications).toHaveLength(20);
    for (const d of notifications) expect(d.group, d.key).toBe('Notifications');
  });

  it('gives each type one row of Toast, Panel and OS switch, after the global switch (FR-108, FR-092)', () => {
    const notifications = SETTINGS_METADATA.filter((d) => d.group === 'Notifications');
    expect(notifications[0]).toMatchObject({ key: 'notifications.os', control: 'toggle' });
    expect(notifications[0]!.row).toBeUndefined();
    for (const type of TYPES) {
      const row = notifications.filter((d) => d.row?.id === `notifications.${type}`).map((d) => d.key);
      expect(row, type).toEqual([`notifications.${type}.toast`, `notifications.${type}.panel`, `notifications.${type}.os`]);
    }
  });

  // Round 5: "OS Notify", independent of the mode, shown only while throng is not focused, and inert
  // (keeping its value) while the global switch is off.
  it('labels each OS leaf "OS Notify", says when it shows, and makes it wait on the global switch', () => {
    for (const type of TYPES) {
      const d = SETTINGS_METADATA.find((x) => x.key === `notifications.${type}.os`)!;
      expect(d.label, type).toBe('OS Notify');
      expect(d.description, type).toMatch(/not focused/);
      expect(d.description, type).toMatch(/whatever Toast and Panel say/i);
      expect(d.enabledWhen, type).toEqual({ key: 'notifications.os', is: true });
    }
  });
});

/**
 * 044 — the preview settings and the navigation history size are REQUIRED leaves.
 *
 * The completeness block at the top already fails in both directions for any leaf of
 * `DEFAULT_APP_SETTINGS`. What it cannot see is a leaf that never reached the defaults at all: a
 * preview section wired into the descriptors but not into `EditorSettings` would pass it as
 * "unknown"-free only by being absent from BOTH sides. So the keys the contract names are listed.
 */
describe('editor.previews.* and editor.navigation.historySize are required leaves (044)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const REQUIRED = [
    'editor.previews.updateDelayMs',
    'editor.previews.maxWaitMs',
    'editor.previews.copyFormat',
    'editor.previews.providers.markdown.enabled',
    'editor.previews.providers.markdown.defaultOpenAction',
    'editor.previews.providers.markdown.loadRemoteImages',
    'editor.navigation.historySize',
    // Iteration 2026-09-15 — FR-114 and FR-117.
    'editor.previews.syncScroll',
    'editor.previews.providers.markdown.showFrontMatter',
  ];

  it('counts every one as a configurable leaf with exactly one descriptor', () => {
    const leaves = settingsLeaves();
    for (const key of REQUIRED) {
      expect(leaves, key).toContain(key);
      expect(SETTINGS_METADATA.filter((d) => d.key === key), key).toHaveLength(1);
    }
  });

  it('describes the history size as a 1–100 slider in steps of 1, shipping 10, under Editor · Navigation (FR-108)', () => {
    const d = byKey.get('editor.navigation.historySize');
    expect(d).toMatchObject({ control: 'slider', min: 1, max: 100, step: 1, group: 'Editor · Navigation' });
    expect(d?.subgroup).toBeUndefined();
    const shipped = DEFAULT_APP_SETTINGS.editor.navigation.historySize;
    expect(shipped).toBe(10);
    expect((shipped - d!.min!) % d!.step!, 'the shipped 10 is between two stops').toBe(0);
  });
});

describe('terminal-flavour controls are HIDDEN for v1.0.0 (#67 re-exposes them)', () => {
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

  it('keeps their descriptors intact for #67 to re-expose (a hide, not a revert)', () => {
    // The controls are withheld, not deleted — #67 re-exposes them by spreading this array back
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
    'search.inFiles.warnIrreversibleCommit',
    // The two FR-082 adds. Listed HERE rather than only in their own describe below, because this
    // array is what holds the section membership for the whole family: a ninth key added to
    // `search.inFiles` and left out of this list is a row rendered under a heading nobody checked.
    'search.inFiles.summaryNoticeMode',
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
 * 043 T199, reshaped by 068 FR-021d — the replace summary notice keeps a display mode of its OWN
 * (FR-082) and loses its timeout: every toast now leaves after the one global toast duration.
 */
describe('the replace summary notice has a display mode of its own (FR-082)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const MODE_KEY = 'search.inFiles.summaryNoticeMode';

  it('offers the three modes the rest of the application offers, under their own names', () => {
    const d = byKey.get(MODE_KEY);
    expect(d, `${MODE_KEY} has no descriptor`).toBeDefined();
    expect(d?.control).toBe('select');
    // Identity: the constant itself, so a fourth mode cannot reach one dropdown and miss this one.
    expect(d?.allowedValues).toBe(DISPLAY_MODES);
    expect(d?.optionLabels).toBe(DISPLAY_MODE_LABELS);
  });

  it('has no timeout descriptor any more', () => {
    expect(byKey.has('search.inFiles.summaryNoticeTimeoutMs')).toBe(false);
  });

  it('ships panel', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.summaryNoticeMode).toBe('panel');
  });

  it('stays OUT of the Notifications section (FR-076)', () => {
    expect(byKey.get(MODE_KEY)?.group).not.toBe('Notifications');
  });

  it('leaves the global defaults as 068 FR-062 and FR-092 set them', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.error).toEqual({ toast: true, panel: true, os: false });
    expect(DEFAULT_NOTIFICATION_SETTINGS.warning).toEqual({ toast: true, panel: true, os: false });
    expect(DEFAULT_NOTIFICATION_SETTINGS.info).toEqual({ toast: true, panel: true, os: false });
    expect(DEFAULT_NOTIFICATION_SETTINGS.success).toEqual({ toast: true, panel: true, os: false });
  });
});

/**
 * 046 US4 — the Unload settings after FR-111 (T125; originally T055, FR-034a/FR-034b).
 *
 * `confirmations.unloadProject` is WITHDRAWN: no project-menu Unload row prompts any more, so a
 * confirmation level for that prompt has nothing to govern, and its descriptor leaves the registry
 * (and with it the Preferences editor). `projects.unloadTerminalAction` stays exactly where it was —
 * key, values, labels, group — because it still decides what the plain **Unload Project** row does
 * and which action the second row names (FR-081).
 *
 * Its DESCRIPTION, though, was written for the dialog era: "when no dialog is shown, and which button
 * the dialog focuses", and "Keep terminals running closes idle shells". Both are now false — there is
 * no dialog (FR-111), and keeping terminals running keeps idle shells too (FR-086). A description is
 * the one place a user reads what a setting does, so it is asserted here rather than left to drift.
 */
describe('the Unload settings in the registry after FR-111 (046 US4)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  it('has no descriptor for confirmations.unloadProject', () => {
    expect(byKey.get('confirmations.unloadProject'), 'the withdrawn confirmation level still has a descriptor').toBeUndefined();
  });

  it('no longer counts confirmations.unloadProject as a configurable leaf', () => {
    expect(settingsLeaves()).not.toContain('confirmations.unloadProject');
  });

  it('still describes projects.unloadTerminalAction as a two-way select, named per data-model §3', () => {
    const d = byKey.get('projects.unloadTerminalAction');
    expect(d, 'projects.unloadTerminalAction has no descriptor').toBeDefined();
    expect(d?.group).toBe('Confirmations');
    expect(d?.control).toBe('select');
    expect(d?.allowedValues).toEqual(['keepRunning', 'endTerminals']);
    expect(d?.label).toBe('Unload project: default terminal action');
    expect(d?.optionLabels).toEqual({
      keepRunning: 'Keep terminals running',
      endTerminals: 'End terminals',
    });
    expect(settingsLeaves()).toContain('projects.unloadTerminalAction');
  });

  it('describes projects.unloadTerminalAction without a dialog (FR-111)', () => {
    const description = byKey.get('projects.unloadTerminalAction')?.description ?? '';
    expect(description).not.toMatch(/dialog|prompt|confirm/i);
  });

  it('describes projects.unloadTerminalAction without closing idle shells (FR-086)', () => {
    const description = byKey.get('projects.unloadTerminalAction')?.description ?? '';
    // Keep terminals running keeps EVERY terminal, idle shells included; saying otherwise tells the
    // user their idle shell will be gone when it will not.
    expect(description).not.toMatch(/clos\w*\s+idle|idle\s+(shells?|terminals?)\s+(are\s+|is\s+)?clos/i);
  });

  it('still says what each value does', () => {
    const description = byKey.get('projects.unloadTerminalAction')?.description ?? '';
    expect(description).toMatch(/keep/i);
    expect(description).toMatch(/end/i);
  });
});

/**
 * The Attention settings the preferences form draws (057 US4 — FR-061, FR-081, FR-082, FR-090).
 * Re-layered from `packages/ui/tests/component/preferences-attention.test.ts` (audit, component-2a):
 * the guard that the registry holds what the form is asserted to draw never needed a DOM.
 */
describe('the Attention settings in the registry (057 US4)', () => {
  const attentionGroup = SETTINGS_METADATA.filter((d) => d.group === 'Attention');
  const terminalAttention = SETTINGS_METADATA.filter((d) => d.group === 'Terminal' && d.subgroup === 'Attention');

  it('keeps the clear delay and the taskbar badge in Attention (FR-108/FR-111: the notification choices moved to Notifications)', () => {
    expect(attentionGroup.map((d) => d.key).sort()).toEqual(['attention.clearDelayMs', 'attention.taskbarBadge']);
  });

  it('holds the master switch, seven signals and the quiet time under Terminal › Attention', () => {
    const keys = terminalAttention.map((d) => d.key);
    expect(keys.filter((k) => k.startsWith('terminals.attention.signals.'))).toHaveLength(7);
    expect(keys).toContain('terminals.attention.enabled');
    expect(keys).toContain('terminals.attention.quietSeconds');
  });
});
