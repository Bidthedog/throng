/**
 * How much xterm buffer each live terminal view holds, by panel id (055 FR-024b).
 *
 * The Resource Monitor's estimate for a terminal's scrollback in the renderer is its retained lines ×
 * columns, and how many of them are styled; the xterm instance lives inside the terminal hook, so — as
 * with `focus-registry.ts` — a registry is the smallest way for something outside it to ask.
 */
export interface TerminalBufferSize {
  readonly lines: number;
  readonly cols: number;
  /** How many of the lines carry an attribute (`styled-lines.ts`, sampled). */
  readonly styledLines: number;
}

const readers = new Map<string, () => TerminalBufferSize>();
const lineReaders = new Map<string, () => string[]>();

export function registerTerminalBuffer(panelId: string, read: () => TerminalBufferSize, lines?: () => string[]): void {
  readers.set(panelId, read);
  if (lines) lineReaders.set(panelId, lines);
}

export function unregisterTerminalBuffer(panelId: string): void {
  readers.delete(panelId);
  lineReaders.delete(panelId);
}

export function getTerminalBufferSize(panelId: string): TerminalBufferSize | undefined {
  return readers.get(panelId)?.();
}

/** Test seam: every live view's buffer size, as the estimate reads it (the calibration E2E). Never used by the UI. */
export function snapshotTerminalBuffers(): Record<string, TerminalBufferSize> {
  const out: Record<string, TerminalBufferSize> = {};
  for (const [panelId, read] of readers) out[panelId] = read();
  return out;
}

declare global {
  interface Window {
    __throngTerminalBuffers?: () => Record<string, TerminalBufferSize>;
    /** Test seam (061): every line a panel's view holds, scrollback included. Never used by the UI. */
    __throngTerminalLines?: (panelId: string) => string[];
  }
}

if (typeof window !== 'undefined') {
  window.__throngTerminalBuffers = snapshotTerminalBuffers;
  window.__throngTerminalLines = (panelId) => lineReaders.get(panelId)?.() ?? [];
}
