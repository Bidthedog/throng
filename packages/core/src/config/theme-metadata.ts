/**
 * Themes editor metadata (feature 007, FR-025a/038). Descriptors for every theme
 * token, driving the grouped Themes form with a control matched to each token's
 * type: colours → colour picker, font family → font-family typeahead, sizes →
 * px picker, weights/numbers → number, `case` → enum, icons → icon.
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
  if (key.startsWith('icons.')) {
    const name = humanise(lastSegment(key));
    return { label: name, description: `The “${name}” icon (glyph or pack image).` };
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
    bold: {
      label: 'Bold',
      description:
        'Bold or not. How bold “bold” is comes from the theme’s Bold weight — most fonts ship only two weights, so this is the only distinction they can actually draw.',
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

/** Infer the descriptor for one theme token path (copy from the hand-written catalogue). */
export function descriptorForThemeToken(key: string): FieldDescriptor {
  const copy = THEME_TOKEN_COPY[key] ?? mechanicalCopy(key);

  if (key.startsWith('colours.')) {
    return { key, label: copy.label, description: copy.description, group: 'Colours', control: 'colour' };
  }
  if (key.startsWith('icons.')) {
    return { key, label: copy.label, description: copy.description, group: 'Icons', control: 'icon' };
  }

  // Fonts + typography roles share the same field inference.
  const field = lastSegment(key);
  let group = 'Fonts';
  if (key.startsWith('typography.')) {
    const role = key.split('.')[1] ?? '';
    group = `Typography: ${humanise(role)}`;
  }

  let control: ControlKind;
  let allowedValues: readonly (string | number)[] | undefined;
  const isRole = key.startsWith('typography.');
  if (field === 'iconPx' || field === 'scrollbarPx') control = 'slider';
  else if (field === 'family') control = 'font-family';
  // 018 / FR-034 — a font SIZE is the first thing FR-034 names as a slider, and it declared bounds
  // (6-96, step 1) while still rendering as a bare text box: the bounds were there, the control was
  // not, and only the forward half of the guard was watching.
  else if (field === 'sizePx' || field === 'baseSizePx') control = 'slider';
  // A ROLE says BOLD OR NOT — a toggle, because that is the only distinction nearly every installed
  // font can actually make. Asked for weight 500, a two-weight font renders regular, so 400, 500 and
  // 600 all looked identical and the slider appeared to do nothing for two thirds of its travel.
  //
  // `fonts.weights.normal` / `.bold` stay numeric sliders on the real CSS 100-900 scale: they are what
  // 'regular' and 'bold' MEAN, and the owner of a variable font can still tune them there — which is
  // the one place the granularity is real.
  else if (field === 'bold' && isRole) control = 'toggle';
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
    ...(control === 'slider' && (field === 'normal' || field === 'bold')
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

/** Build the theme metadata registry from a theme's editable token set. */
export function buildThemeMetadata(theme: Theme): FieldDescriptor[] {
  return themeEditableTokens(theme).map(descriptorForThemeToken);
}

export const THEME_METADATA: MetadataRegistry = buildThemeMetadata(THRONG_THEME);
