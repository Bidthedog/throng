/**
 * How much xterm buffer each live terminal view holds, by panel id (055 FR-024b).
 *
 * The Resource Monitor's estimate for a terminal's scrollback in the renderer is its retained lines ×
 * columns; the xterm instance lives inside the terminal hook, so — as with `focus-registry.ts` — a
 * registry is the smallest way for something outside it to ask. Read only while a monitor is open.
 */
export interface TerminalBufferSize {
  readonly lines: number;
  readonly cols: number;
}

const readers = new Map<string, () => TerminalBufferSize>();

export function registerTerminalBuffer(panelId: string, read: () => TerminalBufferSize): void {
  readers.set(panelId, read);
}

export function unregisterTerminalBuffer(panelId: string): void {
  readers.delete(panelId);
}

export function getTerminalBufferSize(panelId: string): TerminalBufferSize | undefined {
  return readers.get(panelId)?.();
}
