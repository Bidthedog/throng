/**
 * 060 FR-023 — a root-relative path, bounded for a menu label.
 *
 * The Find in Files menu's two narrow replace rows name the file they act on, and a whole path made the
 * menu as wide as the deepest file in the project (SC-005). So the label is cut from the LEFT: the file
 * name is what says which file, and the leading directories are what a reader can spare.
 *
 * ══ WHY WHOLE SEGMENTS ══
 *
 * `…/find-in-files/results-list.tsx` still reads as a path; `…erer/find-in-files/results-list.tsx`
 * reads as a typo. So the cut falls on a `/`, keeping the longest run of trailing segments that fits
 * after the `…/`. Only when the file name alone is too long is a segment cut, and then it is the name's
 * own head that goes, after a bare `…` — the extension and the tail are what tell two files apart.
 *
 * A bound in CHARACTERS gives a bound in width because the menu draws in one fixed font; nothing here
 * measures text, which is what keeps it pure.
 */
export function leftTruncatePath(relPath: string, maxChars = 40): string {
  if (relPath.length <= maxChars) return relPath;
  const segments = relPath.split('/');
  let kept = segments[segments.length - 1];
  if (kept.length + 2 > maxChars) {
    return `…${kept.slice(kept.length - (maxChars - 1))}`;
  }
  for (let i = segments.length - 2; i >= 0; i--) {
    const longer = `${segments[i]}/${kept}`;
    if (longer.length + 2 > maxChars) break;
    kept = longer;
  }
  return `…/${kept}`;
}
