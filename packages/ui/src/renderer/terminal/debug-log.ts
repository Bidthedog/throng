/**
 * Terminal DEBUG lines for the diagnostic log (#290, #162).
 *
 * Both defects are seen on one workstation and nowhere else, only on an installed build, and never
 * under a debugger. So the state a view believed at the moment it went wrong — which screen, whether
 * the program owns the mouse, what xterm itself thinks, what the attach handed over — has to be
 * written down as it happens, where a user can collect it the next morning.
 *
 * Off unless `diagnostics.logLevel` is `debug`. The gate is checked HERE, before the IPC hop, so a
 * wheel spin at the default level costs one boolean test per event and nothing crosses to main.
 * Main applies the threshold again when it writes, so a stale flag can only ever cost a send.
 */

let enabled = false;

/** Follow the user's `diagnostics.logLevel` (wired from the app's settings). */
export function setTerminalDebugLogging(on: boolean): void {
  enabled = on;
}

export function terminalDebugEnabled(): boolean {
  return enabled;
}

/** A field value as one token: strings JSON-quoted, everything else as JSON. */
function field(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return '"<unserialisable>"';
  }
}

/**
 * Write one line: `panel=<id> event=<name> key=value …`.
 *
 * Never throws — a diagnostic that broke the terminal it was watching would be a new defect.
 */
export function terminalDebug(
  panelId: string,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  if (!enabled) return;
  try {
    const parts = [`panel=${panelId}`, `event=${event}`];
    for (const [key, value] of Object.entries(fields)) parts.push(`${key}=${field(value)}`);
    window.throng?.diagnostics?.debug?.(parts.join(' '));
  } catch {
    /* an observer may not kill what it observes */
  }
}
