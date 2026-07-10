/**
 * One-shot per-panel flag marking the NEXT terminal attach as an EXPLICIT user re-type
 * (008 FR-002/FR-007). It is set by the type-selection form's **Confirm** — a deliberate
 * user action — in the window where the user clicked, and consumed by the first
 * {@link import('./use-terminal.js').useTerminal} attach for that panel.
 *
 * A mirror, a re-render, or a reconnect never calls {@link markExplicitRetype}, so it
 * attaches IMPLICITLY and the daemon reuses the running session (which is what prevents
 * the data loss). The flag is deliberately window-local and NOT broadcast: only the
 * confirming window re-types (destroy + create); other windows simply mirror the newly
 * created session. Modelling intent as a stated flag — rather than inferring it from a
 * launch-key comparison — is the whole point (the inference was the original bug).
 */
const pending = new Set<string>();

/** Mark the next attach for `panelId` as an explicit user re-type. */
export function markExplicitRetype(panelId: string): void {
  pending.add(panelId);
}

/** Read AND clear the flag: `true` iff a Confirm marked this panel since the last attach. */
export function consumeExplicitRetype(panelId: string): boolean {
  return pending.delete(panelId);
}
