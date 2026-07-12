// Pure decision logic for the Themes editor's restore & create controls (feature 014).
// No I/O, OS-agnostic (Principle II). Consumed by the renderer and unit-tested here.

export type ThemeRowKind = 'built-in' | 'custom';

export interface ThemeRow {
  readonly name: string;
  readonly kind: ThemeRowKind;
}

/**
 * Entries for the Themes-tab picker: every theme that is PRESENT on disk, tagged `built-in` if its
 * name is in the reserved built-in set (010) and `custom` otherwise, preserving `present` order.
 *
 * A built-in the user has deleted is deliberately NOT listed (FR-005a): it is recovered only by
 * restoring all built-in themes, so there is nothing to select for it.
 */
export function classifyThemes(present: string[], reserved: string[]): ThemeRow[] {
  const reservedSet = new Set(reserved);
  return present.map((name) => ({
    name,
    kind: reservedSet.has(name) ? 'built-in' : 'custom',
  }));
}

export interface ThemeNameValidation {
  ok: boolean;
  reason?: 'empty' | 'reserved' | 'duplicate';
}

/**
 * Validate a proposed Clone/rename name against the reserved built-in set (010) and every theme
 * already present. Precedence: empty -> reserved -> duplicate -> ok. When `renamingFrom` is
 * supplied, that name is excluded from the duplicate check (renaming a theme to its own name is a
 * no-op, not a collision).
 *
 * Comparison is **case-insensitive** and deliberately so: a theme name becomes a FILE name
 * (`themes/<name>.json`), and Windows — the primary target — treats `Throng.json` and
 * `throng.json` as the same file. A case-sensitive check would let a clone named "Throng"
 * silently overwrite the built-in `throng`, and would let a custom named "debian" be clobbered by
 * a later restore writing `Debian.json`. Both are data loss, so names that differ only by case are
 * treated as colliding.
 */
export function validateThemeName(
  name: string,
  ctx: { reserved: string[]; existing: string[]; renamingFrom?: string },
): ThemeNameValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const folded = trimmed.toLowerCase();
  if (ctx.reserved.some((n) => n.toLowerCase() === folded)) return { ok: false, reason: 'reserved' };
  const from = ctx.renamingFrom?.toLowerCase();
  const others = ctx.existing.filter((n) => n.toLowerCase() !== from);
  if (others.some((n) => n.toLowerCase() === folded)) return { ok: false, reason: 'duplicate' };
  return { ok: true };
}

/** Default Clone name: `${source} - Clone`. */
export function cloneName(source: string): string {
  return `${source} - Clone`;
}
