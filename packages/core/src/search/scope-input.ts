/**
 * What the Find in Files scope box's text MEANS (043 FR-092b). Pure.
 *
 * The box accepts a path in two forms and reads both as one scope: ROOT-RELATIVE, which is what the
 * tree's route and the folder chooser write, and ABSOLUTE — a "full" path, the kind *Copy Path →
 * Absolute* and an editor tab hand the user — when it lies inside the project. An absolute path
 * outside the project is FR-070's refusal, extended by FR-092b from the chooser to the keyboard.
 *
 * The containment and relativisation rules are FR-070's own, `isWithinRoot` and `relPathUnderRoot`,
 * rather than a second copy: a typed path and a chosen folder must not disagree about where the
 * project ends.
 *
 * ══ WHY A `..` IS REFUSED RATHER THAN RESOLVED ══
 *
 * `path-id.ts`'s `isUnderPath` gives the reasoning in full and it applies unchanged: resolving needs
 * platform path semantics this package deliberately does not have, and for a path whose meaning
 * cannot be evaluated here the safe answer to "is this inside the project?" is no. A user who typed
 * `../other` is told the path is outside the project, which is true and is the thing they need to
 * know — where clamping it to the root would search somewhere they never named and say nothing.
 */
import { isWithinRoot, relPathUnderRoot } from '../explorer/path-rules.js';

/** A scope the scan can use, root-relative POSIX with `''` for the whole project — or a refusal. */
export type ScopeInput = { kind: 'scope'; subPath: string } | { kind: 'outside' };

/**
 * An absolute path in either platform's spelling: a drive letter — with or without the separator
 * after it — or a leading separator (which on Windows is rooted at the current drive and on POSIX is
 * the root; outside a project either way, unless it is the project's own absolute spelling).
 *
 * The bare drive, `C:`, is here because of the tidy-up below: stripping a trailing separator turns
 * `C:\` into `C:`, and with the separator required this pattern let it through as a RELATIVE path
 * named `C:`, which main then reported as a scope that had gone (043 T261).
 */
const ABSOLUTE = /^(?:[a-z]:(?:\/|$)|\/)/i;

export function readScopeInput(projectRoot: string, text: string): ScopeInput {
  // `\` is a separator here, as it is everywhere this app accepts a path from a person; doubled
  // separators collapse, and a trailing one means nothing — `src/` used to become the row prefix
  // `src//`.
  const tidy = text.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');

  if (tidy === '' || tidy === '.') return { kind: 'scope', subPath: '' };

  // A `..` anywhere is refused, absolute or relative (043 T261). It used to be checked on relative
  // paths only, and an absolute `D:\proj\..\other` passed the root's string-prefix containment test
  // and came out as the subPath `../other` — refused downstream by main's own `..` rule, but not a
  // thing this reading should ever produce.
  if (tidy.split('/').includes('..')) return { kind: 'outside' };

  if (ABSOLUTE.test(tidy)) {
    // The project root itself, spelled out, is the whole project. `relPathUnderRoot` answers null
    // for the root on purpose — its callers reveal a FILE — so the root case is asked separately.
    if (!isWithinRoot(projectRoot, tidy)) return { kind: 'outside' };
    return { kind: 'scope', subPath: relPathUnderRoot(projectRoot, tidy) ?? '' };
  }

  const segments = tidy.split('/').filter((segment) => segment !== '' && segment !== '.');
  return { kind: 'scope', subPath: segments.join('/') };
}
