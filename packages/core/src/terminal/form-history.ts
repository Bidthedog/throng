import { logExpected } from '../diagnostics/caught.js';

/** The New Terminal form's remembered values (067 FR-061 to FR-065). Newest first, distinct, no empties. */
export interface FormHistoryLists {
  readonly startupCommand: string[];
  readonly shellArguments: string[];
}

export type FormHistoryField = keyof FormHistoryLists;

export interface FormHistoryFile {
  readonly version: 1;
  entries: Record<string, FormHistoryLists>;
}

export function recordFormValue(list: readonly string[], value: string, maxEntries: number): string[] {
  if (value.trim() === '') return [...list];
  return [value, ...list.filter((existing) => existing !== value)].slice(0, maxEntries);
}

export function trimFormHistory(file: FormHistoryFile, maxEntries: number): FormHistoryFile {
  const entries: Record<string, FormHistoryLists> = {};
  for (const [flavourId, lists] of Object.entries(file.entries)) {
    entries[flavourId] = {
      startupCommand: lists.startupCommand.slice(0, maxEntries),
      shellArguments: lists.shellArguments.slice(0, maxEntries),
    };
  }
  return { version: 1, entries };
}

/** Never throws: what cannot be read is treated as not remembered. */
export function parseFormHistory(text: string): FormHistoryFile {
  const empty: FormHistoryFile = { version: 1, entries: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logExpected('form-history: parse the file', 'a damaged or absent file is an empty history, and nothing depends on it', error);
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null) return empty;
  const { version, entries } = parsed as { version?: unknown; entries?: unknown };
  if (version !== 1 || typeof entries !== 'object' || entries === null || Array.isArray(entries)) return empty;
  for (const [flavourId, lists] of Object.entries(entries)) {
    const { startupCommand, shellArguments } = (lists ?? {}) as Partial<Record<FormHistoryField, unknown>>;
    if (!Array.isArray(startupCommand) || !Array.isArray(shellArguments)) continue;
    empty.entries[flavourId] = { startupCommand: strings(startupCommand), shellArguments: strings(shellArguments) };
  }
  return empty;
}

function strings(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}
