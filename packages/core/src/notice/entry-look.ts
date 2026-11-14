import type { EntrySeverity } from './notification-entries.js';

/**
 * 068 (FR-071, FR-074) — what a Notifications panel entry looks like by TYPE, as data a test can walk.
 *
 * The entry's background is a pastel tint of its type's colour: `ENTRY_TINT_PERCENT` of the type's colour token mixed
 * into the theme's `surfaceActive`, so every theme — shipped or the user's own — gets the five tints with no token per theme,
 * and the entry's ordinary text colour reads on them (a unit test holds that to 4.5:1 in every shipped theme). The
 * stylesheet spells the same mapping and share; `entry-look.test.ts` and the component test keep the two in step.
 *
 * Each type has an icon token of its own, drawn at the entry's top left. `warning` is the theme's existing warning
 * glyph; the other four are new (`notice*`).
 */

/**
 * The theme surface an entry's tint is mixed into: the raised card surface, not the pane token. An entry is a card inside a
 * panel, and the pane token is reserved for pane bodies and dialog cards (018 FR-001, `surface-token-roles.test.ts`).
 */
export const ENTRY_BASE_SURFACE_TOKEN = 'surfaceActive';

/** How much of the type's colour the entry's background takes, in percent — understated by design. */
export const ENTRY_TINT_PERCENT = 16;

/** The theme colour token each type's tint is made from. */
export const ENTRY_TYPE_COLOUR_TOKEN: Readonly<Record<EntrySeverity, string>> = {
  error: 'danger',
  warning: 'warning',
  attention: 'attentionMark',
  info: 'accent',
  success: 'success',
};

/** The icon token each type draws before its title. */
export const ENTRY_TYPE_ICON_TOKEN: Readonly<Record<EntrySeverity, string>> = {
  error: 'noticeError',
  warning: 'warning',
  attention: 'noticeAttention',
  info: 'noticeInfo',
  success: 'noticeSuccess',
};

/** What each type is called, for the icon's hover title. */
export const ENTRY_TYPE_LABEL: Readonly<Record<EntrySeverity, string>> = {
  error: 'Error',
  warning: 'Warning',
  attention: 'Attention',
  info: 'Information',
  success: 'Success',
};
