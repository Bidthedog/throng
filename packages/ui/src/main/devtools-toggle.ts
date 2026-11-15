import type { OsName } from '@throng/core';

/** The fields of Electron's `before-input-event` input the toggle reads. */
export interface DevToolsToggleInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/**
 * The dev instance's DevTools toggle (028 follow-up): F12, or the platform's primary modifier + Shift + I — Cmd on
 * macOS, where Ctrl+Shift+I belongs to a terminal (070 research R21), Ctrl elsewhere.
 */
export function isDevToolsToggle(input: DevToolsToggleInput, os: OsName): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.key === 'F12') return true;
  const primary = os === 'macos' ? input.meta : input.control;
  return primary && input.shift && input.key.toLowerCase() === 'i';
}
