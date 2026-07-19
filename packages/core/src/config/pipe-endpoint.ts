/**
 * Per-user IPC endpoint derivation (020 FR-013).
 *
 * The daemon's pipe was a single machine-wide constant (`\\.\pipe\throng.daemon`)
 * duplicated in the daemon and UI boundaries, so two OS users on one machine collided
 * on the same endpoint. Both boundaries now derive the DEFAULT pipe name from the
 * current user's token through this ONE pure function.
 *
 * The token is INJECTED (a stable per-user identity — the account SID or username —
 * resolved by the platform layer, Principle II), so nothing here touches the OS; the
 * function stays pure and unit-testable. `THRONG_PIPE_NAME` still overrides the default
 * (tests depend on unique per-test pipes).
 */

/** Reduce a user token to characters legal in a Windows pipe-name segment. */
export function sanitisePipeToken(token: string): string {
  const safe = token.replace(/[^A-Za-z0-9_-]/g, '_');
  return safe.length > 0 ? safe : 'user';
}

/**
 * A small, stable, dependency-free 32-bit FNV-1a hash → 8 hex chars. Kept dependency-free
 * (no `node:crypto`) so `@throng/core` stays usable in every boundary, including the
 * browser renderer.
 */
function tokenHash(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The default per-user pipe name for `token`. A short hash of the RAW token guarantees
 * that distinct tokens yield distinct names even when sanitisation would otherwise
 * flatten them (e.g. `a.b` and `a_b`).
 */
export function defaultPipeName(token: string): string {
  return `\\\\.\\pipe\\throng.${sanitisePipeToken(token)}.${tokenHash(token)}.daemon`;
}
