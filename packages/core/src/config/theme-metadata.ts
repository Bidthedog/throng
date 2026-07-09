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
import { THRONG_THEME, type Theme, type TextCase } from './theme.js';
import { tokensOf, type ControlKind, type FieldDescriptor, type MetadataRegistry } from './metadata.js';

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

/** Infer the descriptor for one theme token path. */
export function descriptorForThemeToken(key: string): FieldDescriptor {
  if (key.startsWith('colours.')) {
    const name = lastSegment(key);
    return {
      key,
      label: humanise(name),
      description: `The “${humanise(name)}” colour token.`,
      group: 'Colours',
      control: 'colour',
    };
  }
  if (key.startsWith('icons.')) {
    const name = lastSegment(key);
    return {
      key,
      label: humanise(name),
      description: `The “${humanise(name)}” icon (glyph or pack image).`,
      group: 'Icons',
      control: 'icon',
    };
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
  if (field === 'family') control = 'font-family';
  else if (field === 'sizePx' || field === 'baseSizePx') control = 'font-size';
  else if (field === 'weight' || field === 'normal' || field === 'bold') control = 'number';
  else if (field === 'case') {
    control = 'enum';
    allowedValues = TEXT_CASES;
  } else if (field === 'italic' || field === 'underline') control = 'toggle';
  else control = 'text';

  return {
    key,
    label: humanise(field),
    description: `The ${group.toLowerCase()} ${humanise(field).toLowerCase()}.`,
    group,
    control,
    ...(allowedValues ? { allowedValues } : {}),
    ...(control === 'font-size' ? { min: 6, max: 96, step: 1 } : {}),
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
  const rolesSeen = new Set<string>();
  const ensureFamily = (role: string): void => {
    if (rolesSeen.has(role)) return;
    rolesSeen.add(role);
    const familyKey = `typography.${role}.family`;
    if (!base.includes(familyKey)) out.push(familyKey); // role doesn't pin a family → expose one
  };
  for (const key of base) {
    if (key.startsWith('typography.')) ensureFamily(key.split('.')[1] ?? '');
    out.push(key);
  }
  // Roles whose override is an empty object (e.g. `paneText: {}`) contribute no
  // base token, but MUST still expose a font control (FR-038).
  for (const role of Object.keys(theme.typography ?? {})) ensureFamily(role);
  return out;
}

/** Build the theme metadata registry from a theme's editable token set. */
export function buildThemeMetadata(theme: Theme): FieldDescriptor[] {
  return themeEditableTokens(theme).map(descriptorForThemeToken);
}

export const THEME_METADATA: MetadataRegistry = buildThemeMetadata(THRONG_THEME);
