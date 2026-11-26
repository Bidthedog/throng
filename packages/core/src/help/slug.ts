/**
 * GitHub's heading slug (080 FR-026, FR-028): trimmed, lower-cased, backticks dropped, every character that
 * is not a letter, number, space, `_` or `-` dropped, and each whitespace character turned into `-`.
 *
 * The guide builder (`scripts/guide-build.mjs`, `slug`) derives a reference section page's path and a
 * heading's anchor by the same rule, so a URL built here from a descriptor's `group` lands on the page the
 * builder wrote for that `##` heading.
 */
export function referenceSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
