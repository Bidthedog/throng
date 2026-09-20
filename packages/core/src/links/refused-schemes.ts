/**
 * 045 FR-159 — core's half of the refused URI schemes: the OS-NEUTRAL ones, which no allowlist can make
 * a link (plan round four strand 2; *Corrections after analysis*, first pass).
 *
 * Each of these hands the OS or a browser engine something to run or to render with authority rather
 * than a place to go: script (`javascript`, `vbscript`), inline content (`data`), the browser's own
 * pages (`about`) and in-memory objects (`blob`). Refused is applied AFTER the allowlist, so a user who
 * allowlists one of them gets nothing.
 *
 * `file` is deliberately NOT here. A `file:` URI is an on-device link (FR-157's class 3) and is
 * classified before any refusal; refusing it is the external opener's rule (FR-037), which lives in
 * UI main's `throng:linkUri:openExternal` predicate only.
 *
 * The OS-specific half (`ms-msdt`, `search-ms`, …) comes from the `IRefusedUriSchemes` port; the
 * renderer unites the two before every scan (research R34).
 */
export const CORE_REFUSED_URI_SCHEMES: ReadonlySet<string> = new Set([
  'javascript',
  'data',
  'vbscript',
  'about',
  'blob',
]);
