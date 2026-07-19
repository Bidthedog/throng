/**
 * US9 / FR-033/034 — compose every window's title through ONE function so the
 * brand always sits LAST, as a suffix.
 *
 * Before 021 each window built a PREFIX title (`throng — <identity>`); this flips
 * it to `<identity> — throng`, so the part the user is actually looking for (the
 * project · context, or "Preferences") reads first and the ` — throng` brand
 * trails it. The separator is an em dash (U+2014) with a single space each side.
 *
 * The `[ADMIN]` elevation marker (main window) is folded into `middle` by the
 * caller BEFORE this runs — `windowTitle(`${mid} [ADMIN]`)` — so the suffix stays
 * last even when elevated (CI runs elevated, and FR-033 makes that ordering
 * load-bearing).
 */
export function windowTitle(middle: string): string {
  return `${middle} — throng`;
}
