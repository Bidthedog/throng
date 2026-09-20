/**
 * Which URI schemes this PLATFORM refuses to hand to any handler, whatever the user allowlists
 * (045 FR-159; Principle II; `contracts/platform-ports.md` §7.1; research R27, R34).
 *
 * FR-159's refused set has two halves. The OS-neutral half — schemes that carry script or inline
 * content rather than a place to go — is core's own constant (`links/refused-schemes.ts`). This port is
 * the other half: schemes whose registered handler, on this platform, can be made to run something from
 * a link. Which schemes those are is an OS fact, so core names none of them.
 *
 * A curated list rather than a live query of the handler registrations: a scheme's name does not say
 * whether its handler executes a file, and reading the registrations per click would put OS work with
 * its own failure modes on the click path (plan round four, Complexity Tracking).
 *
 * Two consumers, both in UI main: the `throng:linkUri:openExternal` handler, which refuses at the click,
 * and the `throng:linkUri:refusedSchemes` handler, which the renderer asks once so a refused scheme is
 * never DRAWN as a link either.
 */
export interface IRefusedUriSchemes {
  /** Lower-case scheme names, no colon, this platform refuses to hand to any handler. Stable per process. */
  refusedSchemes(): ReadonlySet<string>;
}
