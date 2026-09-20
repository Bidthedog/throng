import { CORE_REFUSED_URI_SCHEMES } from '@throng/core';

/**
 * 045 FR-159, US13 scenario 8 — the refused URI schemes as this WINDOW knows them (research R34,
 * data-model §16.9).
 *
 * FR-159's refused set has two halves: core's OS-neutral one, a constant, and the platform's, which
 * lives behind `IRefusedUriSchemes` in UI main (Principle II). "An allowlisted dangerous scheme is not a
 * link" is a DRAWING rule, so the renderer needs both — it asks main once, on first read
 * (`throng:linkUri:refusedSchemes`), and unites the answer with core's half for the window's life: the
 * platform's list is static per process, so one round trip suffices.
 *
 * Until main answers, core's half alone shapes drawing. Nothing is exposed by that gap: main applies
 * the full set on every click (`throng:linkUri:openExternal`). A window with no bridge, or a failed
 * answer, keeps core's half.
 *
 * `file` is never in the set: a `file:` URI is an on-device link (FR-157), refused only at the external
 * opener (FR-037).
 */

let current: ReadonlySet<string> = CORE_REFUSED_URI_SCHEMES;
let asked = false;

export function refusedSchemes(): ReadonlySet<string> {
  if (!asked) ask();
  return current;
}

function ask(): void {
  asked = true;
  const request = typeof window === 'undefined' ? undefined : window.throng?.linkUri?.refusedSchemes;
  if (request === undefined) return;
  void request().then(
    (schemes) => {
      if (!Array.isArray(schemes)) return;
      const platform = schemes
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s !== 'file');
      current = new Set([...CORE_REFUSED_URI_SCHEMES, ...platform]);
    },
    () => {
      /* core's half stays in force; main still refuses at the click */
    },
  );
}

/** Tests only: forget the answer, so the next read asks again. */
export function __resetRefusedSchemesForTests(): void {
  current = CORE_REFUSED_URI_SCHEMES;
  asked = false;
}
