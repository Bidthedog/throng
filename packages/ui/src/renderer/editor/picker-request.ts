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

export function registerPickerOpener(panelId: string, open: () => void): void {
  openers.set(panelId, open);
}

export function unregisterPickerOpener(panelId: string): void {
  openers.delete(panelId);
}

/** Ask the panel's status strip to open its language picker. A no-op if it is not mounted. */
export function requestLanguagePicker(panelId: string): void {
  openers.get(panelId)?.();
}
