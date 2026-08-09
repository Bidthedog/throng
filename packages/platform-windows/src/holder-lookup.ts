import type { Holder } from '@throng/core';

/**
 * 029 FR-012 / FR-014 — which THIRD-PARTY process is holding a path.
 *
 * ══ THIS SEAM EXISTS SO THAT "NOT IDENTIFIED" IS A DECISION, NOT AN OVERSIGHT ══
 *
 * #196 treats naming a foreign program as the achievable half and naming throng as the hard one. It
 * is the other way round. throng already knows where every terminal it launched is working, so
 * naming itself costs a prefix match. Naming `explorer.exe` needs the Windows Restart Manager
 * (`RmStartSession` / `RmGetList`) or handle enumeration — a native addon or FFI, which
 * `windows-directory-lock.ts` names as a design property this package avoids. 029 defers it.
 *
 * Deferred is not the same as forgotten, and the difference has to be visible in the code. So the
 * lookup EXISTS and returns "not identified", which is a stated outcome the message already speaks
 * (`causeMessage` says "open in another program" with no attribution). Three things follow:
 *
 *   • the non-Windows build and the not-yet-implemented Windows one take the SAME branch, so neither
 *     can rot while the other is exercised;
 *   • the call site is written once, for the shape it will always have;
 *   • when the spike lands, one function changes and nothing above it moves.
 *
 * An empty implementation with a name is a design; a missing one is a gap nobody remembers.
 *
 * Tracked as #210, which records why this half was deferred and what implementing it involves.
 */
export function lookupHolder(_absPath: string): Promise<Holder | undefined> {
  // Deliberately not `throw new Error('not implemented')`: this is a FAILURE path, and a lookup that
  // threw would turn "we could not say who" into a second error on top of the user's first.
  return Promise.resolve(undefined);
}
