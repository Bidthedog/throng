import type { TerminalApi } from './use-terminal.js';

/**
 * Which live terminal view belongs to which panel (028, issue 200).
 *
 * The panel wrapper knows a pointer went down on a terminal panel, but it holds no reference to the
 * xterm inside it — the terminal's imperative handle lives in the panel component below it. Focus
 * therefore used to arrive only by routes that run LATER: a mount-time call, and one after the
 * async attach resolves. A user clicking into an idle panel and typing in the same beat produced a
 * keydown while focus was still on document.body, and that character was lost outright — it never
 * became terminal input, so nothing downstream could recover it.
 *
 * This registry is the missing link, and deliberately the smallest one that closes it: a panel id to
 * the live handle, so the pointer-down handler can move focus synchronously, before the keydown that
 * follows the click.
 */
const handles = new Map<string, TerminalApi>();

export function registerTerminalFocus(panelId: string, api: TerminalApi): void {
  handles.set(panelId, api);
}

export function unregisterTerminalFocus(panelId: string): void {
  handles.delete(panelId);
}

/** Move focus into a panel's terminal now. A no-op for a panel with no live terminal. */
export function focusTerminal(panelId: string): void {
  handles.get(panelId)?.focus();
}
