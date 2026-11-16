/**
 * Which markup an icon draws (spec 069 FR-013 to FR-016, FR-034).
 *
 * A theme selects one icon set by name (`iconPack`, its JSON key since spec 007). The default set,
 * `throng`, is compiled in and covers every key; a user set holds only the keys it overrides. So an
 * icon is the selected user set's override when it has one, and the default set's art otherwise —
 * including for a key added after the user set was made, and whenever the set is missing or could
 * not be loaded. Pure and synchronous: an icon renders from memory, never from disk (017 FR-006a/b).
 */
import { DEFAULT_ICON_SET } from './default-icon-set.generated.js';
import type { IconKey } from './icon-keys.js';

/** The name of the default set, which no user set may take (FR-025). */
export const DEFAULT_ICON_SET_NAME = 'throng';

/** A user icon set as main loads it and hands it to every window (data-model *UserIconSet*). */
export interface UserIconSetDto {
  /** The folder name under the user's icon sets directory. */
  name: string;
  /** Sanitised markup for each `<key>.svg` the folder holds; the file's presence is the override. */
  overrides: Partial<Record<IconKey, string>>;
  /** Why a `<key>.svg` the folder holds could not be used; that key draws the default art. */
  failures: Partial<Record<IconKey, string>>;
  /** Files in the folder that are not `<key>.svg` for any key. */
  unrecognised: string[];
  /** Why the whole set could not be read; the theme then draws the default set (FR-016). */
  error?: string;
}

/** The markup to draw for `key` under a theme that selects `theme.iconPack`. */
export function resolveIcon(
  theme: { readonly iconPack?: string },
  sets: readonly UserIconSetDto[],
  key: IconKey,
): string {
  const name = theme.iconPack;
  if (name && name !== DEFAULT_ICON_SET_NAME) {
    const set = sets.find((s) => s.name === name);
    const override = set && !set.error ? set.overrides[key] : undefined;
    if (override) return override;
  }
  return DEFAULT_ICON_SET[key];
}
