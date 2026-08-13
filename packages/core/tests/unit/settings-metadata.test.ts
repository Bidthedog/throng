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
});
