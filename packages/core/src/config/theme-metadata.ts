/**
 * Themes editor metadata (feature 007, FR-025a/038). Descriptors for every theme
 * token, driving the grouped Themes form with a control matched to each token's
 * type: colours → colour picker, font family → font-family typeahead, sizes →
 * px picker, weights/numbers → number, `case` → enum.
 *
 * The registry is DERIVED from the theme structure (one descriptor per token of
 * {@link THRONG_THEME}) so every token is inherently exposed — the structural
 * form of FR-047. The completeness test verifies the control-type inference stays
 * correct for every token shape. Pure; zero OS/DOM.
 */
import {
  OPTIONAL_THEME_COLOUR_TOKENS,
  THRONG_THEME,
  TYPOGRAPHY_ROLES,
  fieldsForRole,
  type Theme,
  type TextCase,
} from './theme.js';
import { tokensOf, type ControlKind, type FieldDescriptor, type MetadataRegistry } from './metadata.js';
import { THEME_TOKEN_COPY } from './theme-copy.js';

const TEXT_CASES: readonly TextCase[] = ['original', 'title', 'lower', 'upper'];

/** Humanise a camelCase/segment token into a label ("appBg" → "App bg"). */
function humanise(segment: string): string {
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function lastSegment(key: string): string {
  const i = key.lastIndexOf('.');
  return i >= 0 ? key.slice(i + 1) : key;
}

/**
 * The label/description a token WOULD get from mechanical inference alone (the
 * pre-009 behaviour: humanised identifier + a self-referential sentence). Retained
 * so the copy test can assert the hand-written descriptions are not derivable from
 * the identifier, and as a safety fallback for any token missing catalogue copy.
 */
export function mechanicalCopy(key: string): { label: string; description: string } {
  if (key.startsWith('colours.')) {
    const name = humanise(lastSegment(key));
    return { label: name, description: `The “${name}” colour token.` };
  }
  const field = lastSegment(key);
  let group = 'Fonts';
  if (key.startsWith('typography.')) {
    group = `Typography: ${humanise(key.split('.')[1] ?? '')}`;
  }

  /**
   * The seven attributes every typography role carries.
   *
   * Ten roles times seven fields is seventy entries, and a hand-written catalogue of seventy would be
   * seventy chances to disagree with itself. The field names are the same on every role, so the copy is
   * written ONCE, per field, and the role's name supplies the rest.
   */
  const ROLE_FIELD_COPY: Record<string, { label: string; description: string }> = {
    family: { label: 'Font', description: 'The typeface. Leave it empty to use the theme’s base font.' },
    sizePx: { label: 'Size', description: 'Size in pixels. Leave it unset to track the theme’s base size.' },
    weight: {
      label: 'Weight',
      description:
        'Font weight from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.',
    },
    case: { label: 'Casing', description: 'Leave the text as written, or force Title, lower or UPPER case.' },
    italic: { label: 'Italic', description: 'Slant the text.' },
    underline: { label: 'Underline', description: 'Rule a line under the text.' },
    strikethrough: { label: 'Strikethrough', description: 'Rule a line through the text.' },
  };

  if (key.startsWith('typography.')) {
    const spec = ROLE_FIELD_COPY[field];
    const role = humanise(key.split('.')[1] ?? '').toLowerCase();
    if (spec) return { label: spec.label, description: `${spec.description} Applies to ${role} text.` };
  }

  return {
    label: humanise(field),
    description: `The ${group.toLowerCase()} ${humanise(field).toLowerCase()}.`,
  };
}

/**
 * The closed vocabulary of label-suffix **properties** (021, US5, FR-018/019/020, data-model §3).
 *
 * A token's label is `"<Context> <Property>"`, and the `<Property>` — the closing word(s) — must be
 * drawn from this list. It carries ONE word per concept, deliberately: `Text` (never `Foreground`)
 * is the only foreground-colour property; `Font Size` is only for a typography size while `Size`
 * (non-font pixel dimensions) and `Width` name different measurements; `Surface` is the fill of a
 * card/panel/field, distinct from the window-wide `Background`. Multi-word entries are listed so the
 * guard can close a label on them (`Hover Background`, `Gutter Text`, …).
 */
export const THEME_PROPERTY_VOCABULARY: readonly string[] = [
  'Background',
  'Hover Background',
  'Text',
  'Hover Text',
  'Border',
  'Hover Border',
  'Surface',
  'Cursor',
  'Selection',
  'Gutter Background',
  'Gutter Text',
  'Highlight',
  'Marker',
  'Track',
  'Thumb',
  'Accent',
  'Width',
  'Font Size',
  'Size',
  'Font',
  'Weight',
  'Bold',
  'Italic',
  'Underline',
  'Strikethrough',
  'Casing',
];

/** A description that merely restates that the token is a colour token — the pre-009 self-reference. */
const SELF_REFERENTIAL_DESCRIPTION = /["“]?.+["”]? colour token/i;

/** Build the `^<Context> <Property>$` label matcher from the vocabulary (longest property first). */
function namingLabelPattern(): RegExp {
  const props = [...THEME_PROPERTY_VOCABULARY]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^([A-Z][\\w&]*(?: [A-Za-z&]+)*) (${props.join('|')})$`);
}

/** A token whose label is a named noun (the icon-ink colour), exempt from the property suffix. */
function isNamedIconToken(key: string): boolean {
  // 069 FR-061 — the file icon categories are named the same way: "Code File Icons", not a property.
  return key === 'colours.iconColour' || /^colours\.fileIcon[A-Z]/.test(key);
}

/**
 * Throw, naming every token whose label/description breaks the naming convention (021, US5,
 * FR-018/019/020). Labels must be `"<Context> <Property>"` in Title Case with `<Property>` drawn
 * from {@link THEME_PROPERTY_VOCABULARY} and a non-empty context; icon labels are exempt from the
 * property suffix (they are named nouns) but must still be non-empty and capitalised. Descriptions
 * must be present-tense sentences of at least 20 characters that name a concrete UI element, are not
 * self-referential, and are not the mechanically-derived copy for the key.
 */
export function assertNamingConvention(registry: MetadataRegistry): void {
  const labelRe = namingLabelPattern();
  const bad: string[] = [];
  for (const d of registry) {
    const label = d.label ?? '';
    if (isNamedIconToken(d.key)) {
      if (label.trim().length === 0 || !/^[A-Z]/.test(label.trim())) {
        bad.push(`${d.key}: icon label "${label}" must be capitalised and non-empty`);
      }
    } else if (!labelRe.test(label)) {
      bad.push(`${d.key}: label "${label}" is not "<Context> <Property>" (Property ∈ vocabulary)`);
    }

    const description = d.description ?? '';
    if (description.trim().length < 20) {
      bad.push(`${d.key}: description "${description}" is too short to name an element`);
    } else if (SELF_REFERENTIAL_DESCRIPTION.test(description)) {
      bad.push(`${d.key}: description "${description}" is self-referential`);
    } else if (description === mechanicalCopy(d.key).description) {
      bad.push(`${d.key}: description merely restates the identifier`);
    }
  }
  if (bad.length) {
    throw new Error(`theme copy violates the naming convention:\n${bad.join('\n')}`);
  }
}

/**
 * The largest the BASE font may be set to.
 *
 * Twenty, because the application has to remain usable at the maximum — and at anything much beyond
 * this, the controls you would need in order to change it back no longer fit on the screen. A setting
 * you cannot undo from inside the application is not a setting.
 */
export const BASE_FONT_MAX_PX = 20;

/** A role's ceiling: the base ceiling, scaled by the proportion that role ships at. */
export function roleSizeMax(key: string): number {
  const role = key.split('.')[1] ?? '';
  const shipped = (THRONG_THEME.typography as Record<string, { sizePx?: number }> | undefined)?.[role]
    ?.sizePx;
  const base = THRONG_THEME.fonts.baseSizePx;
  // A role that pins no size TRACKS the base, so it shares the base's ceiling.
  const ratio = shipped === undefined ? 1 : shipped / base;
  return Math.max(8, Math.round(BASE_FONT_MAX_PX * ratio));
}

/**
 * The closed, ordered set of Themes-editor **area** groups (021, FR-003/FR-004). General first (it
 * explains the areas that follow); Icons last (rendered by the icon section). Every descriptor's `group`
 * is one of these. A dense area nests blocks on the descriptor's heading fields — `subgroup` (Editor →
 * Syntax) and, one level further, `subsection` (General → Buttons → Confirm) — never by encoding them
 * in the group string (079 FR-013, superseding the `"<Area> · <Sub>"` form 021 FR-028 used).
 */
export const THEME_AREA_GROUPS: readonly string[] = [
  'General',
  'Editor',
  // 075 FR-021 — the Markdown preview's own colours (its callouts), after the Editor whose colours it otherwise reads.
  'Markdown preview',
  'Main panel / workspace',
  'Sub-workspace',
  'Terminal',
  'File Explorer',
  'Preferences',
  'Projects / sidebar',
  'Search',
  'Icons',
];

/** The area a token takes when NO rule places it — outside {@link THEME_AREA_GROUPS}, so the guard flags it. */
const UNASSIGNED_AREA = '(unassigned)';

/** Where a token sits in the Themes editor: its area, and optionally the heading blocks inside it (079 FR-014). */
export interface ThemePlacement {
  group: string;
  subgroup?: string;
  subsection?: string;
}

/** typography role → placement (021, data-model §2). */
const TYPOGRAPHY_AREA: Record<string, ThemePlacement> = {
  editor: { group: 'Editor' },
  terminal: { group: 'Terminal' },
  paneTitle: { group: 'Main panel / workspace' },
  tab: { group: 'Main panel / workspace' },
  panel: { group: 'Main panel / workspace' },
  paneText: { group: 'Main panel / workspace' },
  projectName: { group: 'Projects / sidebar' },
  projectPath: { group: 'Projects / sidebar' },
  // The base button typography is the Buttons subgroup's own rows, so it renders ABOVE the three
  // per-type colour subsections (Confirm / Cancel / Destroy). The `dialog` role was retired in 021
  // (dialogs inherit the base font), so it no longer appears here.
  button: { group: 'General', subgroup: 'Buttons' },
};

/** The non-prefix colours whose home is a specific pane (021, data-model §2). */
const COLOUR_AREA: Record<string, string> = {
  // 021 consolidated the File Explorer's `activePaneHighlight` onto `activePanelBorder`, so the active
  // pane/panel highlight is one token filed here.
  activePanelBorder: 'Main panel / workspace',
  activePanelBorderInactive: 'Main panel / workspace',
  railBg: 'Main panel / workspace',
  sidebarBg: 'Projects / sidebar',
  // 046 iterate round 1 (FR-072) — the Projects pane's category header strip.
  categoryHeaderBackground: 'Projects / sidebar',
  // 074 FR-027a, FR-027b — a picture preview's canvas and transparency hatch: drawn inside a panel.
  pictureCanvas: 'Main panel / workspace',
  pictureHatch: 'Main panel / workspace',
};

/**
 * The genuinely application-wide colours — the ONLY way a colour reaches General (FR-005). Listed
 * explicitly rather than defaulted, so a NEW colour token that fits no rule falls through to the
 * sentinel and fails the guard instead of being silently absorbed into General (SC-003).
 */
const GENERAL_COLOURS: ReadonlySet<string> = new Set([
  'accent', 'accentText', 'appBg', 'border', 'danger', 'dangerText', 'errorSurface', 'errorText',
  'hoverSurface', 'inputSurface', 'menuItemHoverSurface', 'scrollbarThumb', 'scrollbarTrack',
  // 045 FR-138 — links are marked the same way in editors AND terminals, so no one area owns them.
  'linkUnderline', 'linkUnderlineHover',
  // 045 FR-165g — the link hint is one shared component across editors, terminals AND the Markdown
  // preview (FR-166), so it is no more one area's than the underline above.
  'linkHintBackground', 'linkHintText', 'linkHintBorder',
  'statusBarBg', 'success', 'warning',
  // 057 (R11) — a mark shows on panels, projects, categories and the taskbar, so no one area owns it.
  'attentionMark',
  // `surface`/`surfaceActive` are the present-day, overloaded former `panelSurface` (#62) — no single
  // dominant area, so General is their home (FR-014). 021 removed `menuSurface`/`dialogSurface` and the
  // four legacy `button*` tokens; the 18 typed button tokens live in General → Buttons (§2, Buttons).
  'surface', 'surfaceActive', 'text', 'textMuted', 'unsavedDot',
]);

/**
 * Where a theme token sits (021, FR-001/FR-007; 079 FR-014): its app AREA, and any heading blocks
 * inside it. Returns `undefined` for a token no rule places — there is NO silent default.
 * `descriptorForThemeToken` turns that into the sentinel group, so an unplaced (typically new) token fails {@link assertThemeAreaGroups}, forcing its author to
 * declare where it appears. The Icons area holds the icon-COLOUR token (a theme carries no icon tokens since 069).
 */
function placementForToken(key: string): ThemePlacement | undefined {
  if (key === 'colours.iconColour') return { group: 'Icons' };
  // 069 FR-061 — they colour the File Explorer's and Find in Files' icons, so they sit with the File Explorer.
  if (/^colours\.fileIcon[A-Z]/.test(key)) return { group: 'File Explorer', subgroup: 'File Icons' };
  if (key.startsWith('typography.')) return TYPOGRAPHY_AREA[key.split('.')[1] ?? ''];
  if (key.startsWith('fonts.')) return { group: 'General' }; // base fonts are app-wide (data-model §2)
  // The size tokens are placed EXPLICITLY, not by a `sizes.*` blanket — so a NEW size token fails the
  // guard rather than silently defaulting to General (SC-003). Both current ones are app-wide sizing;
  // `iconPx` stays in the General list (not the Icons area) because it is a slider rendered inline,
  // and an 'Icons' group here would collide with the icon section's own 'Icons' heading.
  if (key === 'sizes.iconPx' || key === 'sizes.scrollbarPx') return { group: 'General' };
  if (key.startsWith('colours.')) {
    const name = lastSegment(key);
    // The three-type button model (021, FR-027): each token sits in its type's subsection of General →
    // Buttons, so the Themes editor renders Confirm / Cancel / Destroy as distinct blocks (079 FR-014).
    // 069 FR-054 — the icon button's resting background sits with the other button tokens.
    if (name === 'iconButtonSurface') return { group: 'General', subgroup: 'Buttons' };
    // 069 FR-060 — the title bar is part of every window, so it sits with the app-wide colours.
    if (name === 'titleBarSurface') return { group: 'General' };
    const button = /^(confirm|cancel|destroy)Button/.exec(name);
    if (button) {
      const type = button[1];
      return { group: 'General', subgroup: 'Buttons', subsection: `${type.charAt(0).toUpperCase()}${type.slice(1)}` };
    }
    if (name.startsWith('syntax')) return { group: 'Editor', subgroup: 'Syntax' };
    if (name.startsWith('editor')) return { group: 'Editor' };
    // 075 FR-021 — the seven callout colour roles.
    if (name.startsWith('callout')) return { group: 'Markdown preview', subgroup: 'Callouts' };
    if (name.startsWith('terminal')) return { group: 'Terminal' };
    if (name.startsWith('searchMatch')) return { group: 'Search' };
    if (name in COLOUR_AREA) return { group: COLOUR_AREA[name] };
    if (GENERAL_COLOURS.has(name)) return { group: 'General' };
  }
  return undefined;
}

/** The app AREA (group) a theme token belongs to, or `undefined` when no rule places it. 079: the area only. */
export function areaForToken(key: string): string | undefined {
  return placementForToken(key)?.group;
}


/**
 * Throw, naming every descriptor whose area is outside {@link THEME_AREA_GROUPS} (021, FR-009/FR-010).
 * Combined with {@link assertEveryKeyDescribed} (exactly one descriptor per token) this makes each
 * token belong to exactly one group drawn from the closed set — and, because an unplaced token carries
 * the {@link UNASSIGNED_AREA} sentinel, adding a token without assigning it an area fails the build.
 */
export function assertThemeAreaGroups(registry: MetadataRegistry): void {
  const allowed = new Set(THEME_AREA_GROUPS);
  const bad = registry
    .filter((d) => !allowed.has(d.group))
    .map((d) => `${d.key} → ${d.group}`);
  if (bad.length) {
    throw new Error(`theme tokens with an unknown area group: ${bad.join(', ')}`);
  }
}

/** Infer the descriptor for one theme token path (copy from the hand-written catalogue). */
export function descriptorForThemeToken(key: string): FieldDescriptor {
  const copy = THEME_TOKEN_COPY[key] ?? mechanicalCopy(key);
  // 021 — the group is the app AREA the token relates to, not its type. Unplaced → sentinel (guard fails).
  const placement: ThemePlacement = placementForToken(key) ?? { group: UNASSIGNED_AREA };
  const { group } = placement;
  // 079 FR-014 — the heading blocks ride on the descriptor's own fields, present only when set.
  const headings = {
    ...(placement.subgroup ? { subgroup: placement.subgroup } : {}),
    ...(placement.subsection ? { subsection: placement.subsection } : {}),
  };

  if (key.startsWith('colours.')) {
    return { key, label: copy.label, description: copy.description, group, ...headings, control: 'colour' };
  }

  // Fonts + typography roles share the same field inference.
  const field = lastSegment(key);

  let control: ControlKind;
  let allowedValues: readonly (string | number)[] | undefined;
  const isRole = key.startsWith('typography.');
  if (field === 'iconPx' || field === 'scrollbarPx') control = 'slider';
  else if (field === 'family') control = 'font-family';
  // 018 / FR-034 — a font SIZE is the first thing FR-034 names as a slider, and it declared bounds
  // (6-96, step 1) while still rendering as a bare text box: the bounds were there, the control was
  // not, and only the forward half of the guard was watching.
  else if (field === 'sizePx' || field === 'baseSizePx') control = 'slider';
  // A ROLE's WEIGHT is a slider on the real CSS 100-900 scale (021). It was a boolean `bold` toggle,
  // on the theory that a two-weight font makes 400/500/600 render identically — true, but that is the
  // font's limit to expose, not ours to hide: a checkbox that could render a role LIGHTER than a
  // sibling (when the theme's bold weight was set low) was a worse answer than a slider that says
  // exactly what it will do. Unset → the role tracks `fonts.weights.normal`. `fonts.weights.normal` /
  // `.bold` remain sliders on the same scale — the base weights every unset role inherits.
  else if (field === 'weight' && isRole) control = 'slider';
  else if (field === 'normal' || field === 'bold') control = 'slider';
  else if (field === 'case') {
    control = 'enum';
    allowedValues = TEXT_CASES;
  } else if (field === 'italic' || field === 'underline' || field === 'strikethrough')
    control = 'toggle';
  else control = 'text';

  return {
    key,
    label: copy.label,
    description: copy.description,
    group,
    ...headings,
    control,
    // A font stack may be emptied outright (015, FR-018): the app has a fallback family, so
    // "no preference" is a real answer, not a broken one. It is the clearest case of a value
    // whose SHIPPED default is populated yet which is still legitimately clearable.
    ...(control === 'font-family' ? { clearable: true } : {}),
    ...(allowedValues ? { allowedValues } : {}),
    // Sizes in px, and weights on the real CSS `font-weight` scale. Two different ranges behind one
    // control kind, which is why the bounds are chosen per FIELD rather than per control.
    // 018 follow-up — a font-size slider that ran to 96px let you set the BASE font to 96 and destroy
    // the application: every pane, tab and dialog blew up at once and there was no longer a control
    // small enough to click in order to undo it. A maximum is not a limitation here, it is the
    // difference between a setting and a trap.
    //
    // The base caps at 20. Every role caps at ITS OWN SHIPPED PROPORTION of that — a pane title ships
    // at 11 against a base of 13, so it caps at 20 × 11/13 ≈ 17, and stays a pane title rather than
    // becoming a headline. The ratio is read from the shipped theme, so it cannot drift from it.
    ...(control === 'slider' && field === 'baseSizePx' ? { min: 6, max: BASE_FONT_MAX_PX, step: 1 } : {}),
    ...(control === 'slider' && field === 'sizePx' ? { min: 6, max: roleSizeMax(key), step: 1 } : {}),
    ...(control === 'slider' && field === 'iconPx' ? { min: 10, max: 32, step: 1 } : {}),
    ...(control === 'slider' && field === 'scrollbarPx' ? { min: 6, max: 24, step: 1 } : {}),
    ...(control === 'slider' && (field === 'normal' || field === 'bold' || field === 'weight')
      ? { min: 100, max: 900, step: 100 }
      : {}),
  };
}

/**
 * The editable token paths of a theme: every structural token PLUS a
 * `typography.<role>.family` for every typography role that does not already pin
 * a family in the theme (H4, FR-038 — every typography section must expose the
 * font control, not only roles that hardcode a family). The injected family key
 * is placed just before the role's first structural token so it heads the
 * section. `fonts.family` is already a structural token, so the base family is
 * covered without injection.
 */
export function themeEditableTokens(theme: Theme): string[] {
  const base = tokensOf(theme);
  const out: string[] = [];

  // EVERY role offers EVERY attribute.
  //
  // This used to expose only the fields a theme happened to PIN, plus an injected family. So a role
  // declared as `tab: { weight: 500 }` offered a weight and a family — and there was no way to
  // italicise a tab title, however much you wanted to, because the theme's author had not thought to
  // italicise it first. The editor's completeness is meant to be a property of the MODEL, not a shadow
  // of one theme's choices.
  for (const key of base) {
    if (key.startsWith('typography.')) continue; // superseded by the full set below
    out.push(key);
  }
  for (const role of TYPOGRAPHY_ROLES) {
    for (const field of fieldsForRole(role)) out.push(`typography.${role}.${field}`);
  }

  // 018 / FR-031a — the OPTIONAL colour tokens. `iconColour` is deliberately unset, because its
  // absence means "icons inherit their host's colour" (FR-029). An unset token is not a leaf, so it
  // contributes nothing above — yet the constitution's configuration-editor-completeness rule is
  // NON-NEGOTIABLE: every theme token must be editable in the visual editor. Union it in.
  for (const token of OPTIONAL_THEME_COLOUR_TOKENS) {
    const key = `colours.${token}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Build the theme metadata registry from a theme's editable token set, **ordered by area** (021,
 * FR-004): descriptors are stably sorted by area index in THEME_AREA_GROUPS, then subgroup, then
 * subsection, then theme-declared token order. So the renderer — which emits one section per area and
 * its heading blocks in first-appearance order — shows General first, Icons last, an area's own tokens
 * before its subgroups (Editor before Syntax), and a subgroup's own tokens before its subsections. An
 * unplaced token's sentinel area sorts to the end (rank = length). 079 FR-015 keeps the resulting row
 * order exactly what the old `"<Area> · <Sub>"` sort produced.
 */
// No heading sorts first at each level (an area's own tokens, then its blocks). Among blocks,
// alphabetical is right everywhere EXCEPT the button types: Confirm, Cancel, Destroy — not the
// alphabetical Cancel, Confirm, Destroy. A tiny explicit rank does that.
const BUTTON_SUBSECTION_ORDER: Readonly<Record<string, number>> = { Confirm: 0, Cancel: 1, Destroy: 2 };
function headingOrder(a: string | undefined, b: string | undefined, rank?: Readonly<Record<string, number>>): number {
  if ((a ?? '') === (b ?? '')) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const ra = rank?.[a];
  const rb = rank?.[b];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  return a.localeCompare(b);
}

export function buildThemeMetadata(theme: Theme): FieldDescriptor[] {
  const rank = (group: string): number => {
    const i = THEME_AREA_GROUPS.indexOf(group);
    return i < 0 ? THEME_AREA_GROUPS.length : i;
  };
  return themeEditableTokens(theme)
    .map((key, i) => ({ d: descriptorForThemeToken(key), i }))
    .sort(
      (a, b) =>
        rank(a.d.group) - rank(b.d.group) ||
        a.d.group.localeCompare(b.d.group) ||
        headingOrder(a.d.subgroup, b.d.subgroup) ||
        headingOrder(a.d.subsection, b.d.subsection, a.d.subgroup === 'Buttons' ? BUTTON_SUBSECTION_ORDER : undefined) ||
        a.i - b.i,
    )
    .map((x) => x.d);
}

export const THEME_METADATA: MetadataRegistry = buildThemeMetadata(THRONG_THEME);
