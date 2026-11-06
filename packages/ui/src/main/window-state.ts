import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logCaught, logExpected } from '@throng/core';

/** Persisted main-window geometry (FR-047). */
export interface SavedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/** Read the saved window state, or null if absent/unreadable. */
export function loadWindowState(path: string): SavedWindowState | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SavedWindowState>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return parsed as SavedWindowState;
    }
  } catch (error) {
    logExpected('window-state: load', 'the file is absent until the window first closes; defaults apply', error);
  }
  return null;
}

/** Persist the window state (best-effort; never throws into the close path). */
export function saveWindowState(path: string, state: SavedWindowState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
  } catch (error) {
    // Storage unavailable — losing window geometry is non-fatal.
    logCaught('window-state: save', error);
  }
}
