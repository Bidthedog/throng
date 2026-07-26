/**
 * Opening the language picker from somewhere other than the status strip (016, FR-012).
 *
 * FR-010 gives the picker two entry points — the status strip, and the content menu's
 * "Set Language…" — and they must open the SAME picker. The strip owns it (it renders it, anchored
 * to itself), so the menu needs a way to ask, rather than a second picker of its own that could
 * drift out of step with the first.
 *
 * The same register/lookup idiom as the editor view and panel search registries.
 */
const openers = new Map<string, () => void>();
/**
 * Fallbacks for when the strip is NOT mounted (024 US1: the status bar is preference-controlled and
 * can be hidden). Registered by the editor panel, which is what decides whether the strip renders.
 * Without this, "Set Language…" silently did nothing whenever a user had turned the bar off — a menu
 * item that is present, enabled, and inert is worse than one that is absent.
 */
const reveals = new Map<string, () => void>();

export function registerPickerOpener(panelId: string, open: () => void): void {
  openers.set(panelId, open);
}

export function unregisterPickerOpener(panelId: string): void {
  openers.delete(panelId);
}

/** Register the panel's "show the hidden strip, with its picker already open" fallback. */
export function registerPickerReveal(panelId: string, reveal: () => void): void {
  reveals.set(panelId, reveal);
}

export function unregisterPickerReveal(panelId: string): void {
  reveals.delete(panelId);
}

/**
 * Ask the panel's status strip to open its language picker — revealing the strip first if the
 * preference has it hidden. A no-op only when the panel has no editor at all.
 */
export function requestLanguagePicker(panelId: string): void {
  const open = openers.get(panelId);
  if (open) {
    open();
    return;
  }
  reveals.get(panelId)?.();
}
