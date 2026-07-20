import { describe, it, expect } from 'vitest';
import {
  THEME_METADATA,
  THEME_AREA_GROUPS,
  areaForToken,
  assertThemeAreaGroups,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { assertEveryKeyDescribed, auditRegistry, type FieldDescriptor } from '../../src/config/metadata.js';
import { filterFields } from '../../src/config/settings-search.js';
import { THRONG_THEME, TYPOGRAPHY_ROLES, fieldsForRole } from '../../src/config/theme.js';

/** The parent area of a (possibly "Parent · Child") group string. */
const areaOf = (group: string): string => group.split(' · ')[0];

describe('THEME_METADATA completeness (FR-038/047)', () => {
  const tokens = themeEditableTokens(THRONG_THEME);

  it('describes every editable theme token and no unknown keys', () => {
    expect(() => assertEveryKeyDescribed(tokens, THEME_METADATA)).not.toThrow();
    expect(auditRegistry(tokens, THEME_METADATA)).toEqual({ missing: [], unknown: [], duplicated: [] });
  });

  it('places every token in a valid area group (021, FR-009 — build-blocking)', () => {
    // The completeness guard now also enforces closed-set area membership: a token added without an
    // area assignment carries the sentinel group and fails here, forcing "where does this appear?".
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });

  it('exposes a font-family control for every typography role + the base family (H4, FR-038)', () => {
    // Every typography role — even those that do NOT pin a family in the default.
    for (const role of Object.keys(THRONG_THEME.typography ?? {})) {
      const key = `typography.${role}.family`;
      const desc = THEME_METADATA.find((d) => d.key === key);
      expect(desc, key).toBeDefined();
      expect(desc!.control, key).toBe('font-family');
    }
    expect(THEME_METADATA.find((d) => d.key === 'fonts.family')?.control).toBe('font-family');
  });

  it('covers the 18 typed button colour tokens + the button font (021, US7 / FR-047)', () => {
    const buttonKeys = ['confirm', 'cancel', 'destroy'].flatMap((t) =>
      ['Bg', 'HoverBg', 'Border', 'HoverBorder', 'Text', 'HoverText'].map((v) => `colours.${t}Button${v}`),
    );
    for (const key of buttonKeys) {
      const desc = THEME_METADATA.find((d) => d.key === key);
      expect(desc, key).toBeDefined();
      expect(desc!.control, key).toBe('colour');
      const type = key.slice('colours.'.length).replace(/Button.*/, '');
      const cap = `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
      expect(desc!.group, key).toBe(`General · Buttons · ${cap}`);
    }
    // The four legacy button tokens no longer appear in the registry.
    for (const legacy of ['colours.buttonBg', 'colours.buttonText', 'colours.buttonHoverBg', 'colours.buttonHoverText']) {
      expect(THEME_METADATA.find((d) => d.key === legacy), legacy).toBeUndefined();
    }
    expect(THEME_METADATA.find((d) => d.key === 'typography.button.family')?.control).toBe('font-family');
  });

  it('has unique keys and non-empty label/description/group', () => {
    const seen = new Set<string>();
    for (const d of THEME_METADATA) {
      expect(seen.has(d.key), d.key).toBe(false);
      seen.add(d.key);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.group.length).toBeGreaterThan(0);
    }
  });
});

describe('control-type inference (FR-038)', () => {
  it('colour tokens → colour, icon tokens → icon', () => {
    expect(descriptorForThemeToken('colours.accent').control).toBe('colour');
    // 021 — the group is now the app AREA, not the token type. `appBg` is app-wide → General.
    expect(descriptorForThemeToken('colours.appBg').group).toBe('General');
    expect(descriptorForThemeToken('icons.folder').control).toBe('icon');
    expect(descriptorForThemeToken('icons.terminal').group).toBe('Icons');
  });

  it('font family/size/weight/case map to the right controls', () => {
    expect(descriptorForThemeToken('fonts.family').control).toBe('font-family');
    // 018 / FR-034: a font SIZE is a slider. It declared bounds (6-96) and still rendered as a bare
    // text box — the descriptor disagreed with itself, and only the forward guard was watching.
    expect(descriptorForThemeToken('fonts.baseSizePx').control).toBe('slider');
    expect(descriptorForThemeToken('fonts.weights.normal').control).toBe('slider'); // 018: weights gained the CSS 100-900 range they never had
    expect(descriptorForThemeToken('typography.editor.family').control).toBe('font-family');
    expect(descriptorForThemeToken('typography.paneTitle.sizePx').control).toBe('slider');
    // A ROLE's weight is a SLIDER on the real CSS 100-900 scale (021) — it was a boolean toggle, which
    // could render a role lighter than a sibling when the theme's bold weight was low. The base weights
    // it inherits (`fonts.weights.*`) are sliders on the same scale.
    expect(descriptorForThemeToken('typography.tab.weight').control).toBe('slider');
    expect(descriptorForThemeToken('typography.tab.weight').min).toBe(100);
    expect(descriptorForThemeToken('typography.tab.weight').max).toBe(900);
    expect(descriptorForThemeToken('fonts.weights.bold').control).toBe('slider');
    // Every non-editor/terminal role carries the FULL decoration set.
    expect(descriptorForThemeToken('typography.tab.strikethrough').control).toBe('toggle');
    expect(descriptorForThemeToken('typography.panel.italic').control).toBe('toggle');
    const caseDesc = descriptorForThemeToken('typography.paneTitle.case');
    expect(caseDesc.control).toBe('enum');
    expect(caseDesc.allowedValues).toEqual(['original', 'title', 'lower', 'upper']);
  });

  it('every typography role offers every attribute (not just the ones its theme pinned)', () => {
    // The editor used to expose only the fields a theme happened to PIN — so `tab: { weight: 500 }`
    // offered a weight and a family, and a tab title could not be italicised however much you wanted
    // to, because its author had not thought to italicise it first. Completeness is a property of the
    // MODEL, not a shadow of one theme's choices.
    for (const role of TYPOGRAPHY_ROLES) {
      // The TERMINAL is not HTML: xterm draws its glyphs on a canvas from a family and a size, and can
      // honour nothing else. A control that cannot possibly do anything is worse than a missing one.
      for (const field of fieldsForRole(role)) {
        const key = `typography.${role}.${field}`;
        expect(
          THEME_METADATA.find((d) => d.key === key),
          `${key} is not editable`,
        ).toBeDefined();
      }
    }
  });

  it('every descriptor with allowedValues uses a choice control', () => {
    for (const d of THEME_METADATA) {
      if (d.allowedValues) expect(['select', 'multiselect', 'enum'], d.key).toContain(d.control);
    }
  });
});

describe('area grouping (021, FR-001..FR-009)', () => {
  it('THEME_AREA_GROUPS is the closed, ordered set — General first, Icons last', () => {
    expect(THEME_AREA_GROUPS).toEqual([
      'General',
      'Editor',
      'Main panel / workspace',
      'Sub-workspace',
      'Terminal',
      'File Explorer',
      'Preferences',
      'Projects / sidebar',
      'Search',
      'Icons',
    ]);
    expect(THEME_AREA_GROUPS[0]).toBe('General');
    expect(THEME_AREA_GROUPS[THEME_AREA_GROUPS.length - 1]).toBe('Icons');
  });

  it('every descriptor belongs to an area in the closed set (FR-003/FR-006)', () => {
    for (const d of THEME_METADATA) {
      expect(THEME_AREA_GROUPS, `${d.key} → ${d.group}`).toContain(areaOf(d.group));
    }
  });

  it('renders areas in THEME_AREA_GROUPS order, Editor before Editor · Syntax (FR-004)', () => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const d of THEME_METADATA) {
      if (!seen.has(d.group)) {
        seen.add(d.group);
        order.push(d.group);
      }
    }
    expect(order[0]).toBe('General');
    const areaIdx = (g: string): number => THEME_AREA_GROUPS.indexOf(areaOf(g));
    const idxs = order.map(areaIdx);
    for (let i = 1; i < idxs.length; i += 1) {
      expect(idxs[i], `area order broken at ${order[i]}`).toBeGreaterThanOrEqual(idxs[i - 1]);
    }
    expect(order.indexOf('Editor')).toBeLessThan(order.indexOf('Editor · Syntax'));
  });

  it('assigns each token to its primary area (FR-005/FR-007/FR-014, spot checks)', () => {
    const g = (k: string): string => descriptorForThemeToken(k).group;
    expect(g('colours.editorGutterBg')).toBe('Editor');
    expect(g('colours.terminalFg')).toBe('Terminal');
    expect(g('colours.syntaxKeyword')).toBe('Editor · Syntax');
    expect(g('colours.surface')).toBe('General'); // the overloaded former panelSurface → General
    expect(g('colours.searchMatch')).toBe('Search');
    expect(g('colours.railBg')).toBe('Main panel / workspace');
    expect(g('colours.sidebarBg')).toBe('Projects / sidebar');
    // 021 follow-up: the File Explorer's separate highlight folded onto the one active-pane token.
    expect(g('colours.activePanelBorder')).toBe('Main panel / workspace');
    expect(g('typography.projectName.family')).toBe('Projects / sidebar');
    expect(g('typography.editor.family')).toBe('Editor');
    // The base button typography lives in its own General · Buttons subsection (021 follow-up).
    expect(g('typography.button.weight')).toBe('General · Buttons');
    expect(g('icons.terminal')).toBe('Icons');
  });

  it('the ten syntax colours share the Editor · Syntax sub-group (FR-003a)', () => {
    const syntax = THEME_METADATA.filter((d) => d.key.startsWith('colours.syntax'));
    expect(syntax.length).toBe(10);
    for (const d of syntax) expect(d.group).toBe('Editor · Syntax');
  });

  it('groups the 18 button tokens under General · Buttons · <Type> (021, US7)', () => {
    expect(areaForToken('colours.confirmButtonBg')).toBe('General · Buttons · Confirm');
    expect(areaForToken('colours.cancelButtonHoverText')).toBe('General · Buttons · Cancel');
    expect(areaForToken('colours.destroyButtonBorder')).toBe('General · Buttons · Destroy');
    // Their parent area is General, so the closed-set guard accepts them.
    expect(areaOf('General · Buttons · Confirm')).toBe('General');
  });

  it('(G1) a group-name search surfaces every nested button row (FR-016)', () => {
    const buttons = filterFields('Buttons', THEME_METADATA, () => '');
    const buttonRows = buttons.filter((d) => /Button/.test(d.key));
    expect(buttonRows).toHaveLength(18);
    // "General" surfaces all of General including the nested button sub-groups.
    const general = filterFields('General', THEME_METADATA, () => '');
    expect(general.filter((d) => /Button/.test(d.key))).toHaveLength(18);
  });

  it('the completeness guard passes for the real registry, with no unassigned token (FR-009)', () => {
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
    for (const d of THEME_METADATA) expect(d.group).not.toBe('(unassigned)');
  });

  it('the guard fails, naming the token, when an area is outside the closed set (FR-010)', () => {
    const bad: FieldDescriptor = {
      key: 'colours.appBg',
      label: 'App background',
      description: 'x',
      group: 'Nonsense',
      control: 'colour',
    };
    expect(() => assertThemeAreaGroups([bad])).toThrowError(/colours\.appBg/);
    expect(() => assertThemeAreaGroups([bad])).toThrowError(/Nonsense/);
  });

  it('a new token nobody assigned an area fails the guard — no silent General default (SC-003)', () => {
    // areaForToken cannot place it, so its descriptor takes the sentinel area outside the closed set.
    expect(areaForToken('colours.somethingNobodyMapped')).toBeUndefined();
    const orphan = descriptorForThemeToken('colours.somethingNobodyMapped');
    expect(orphan.group).toBe('(unassigned)');
    expect(() => assertThemeAreaGroups([orphan])).toThrowError(/colours\.somethingNobodyMapped/);
    // The size tokens are placed EXPLICITLY, not by a `sizes.*` blanket — so a NEW size token is
    // unplaced and would fail the guard too (no silent namespace default). The two current ones ARE
    // placed.
    expect(areaForToken('sizes.gutterPx')).toBeUndefined();
    expect(areaForToken('sizes.iconPx')).toBe('General');
    expect(areaForToken('sizes.scrollbarPx')).toBe('General');
  });
});
