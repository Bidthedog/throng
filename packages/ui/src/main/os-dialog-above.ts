/**
 * An OS window opens over every throng window (maintainer, 2026-11-22). A throng window kept on top — Print Preview
 * (075 FR-071), or Preferences while throng has focus — would otherwise stand above the OS's Save, Open or message
 * dialog it asked for. Each such window stands down while the dialog is open and goes back on top once it closes,
 * however the dialog ends.
 */
export interface LayeredWindow {
  isDestroyed(): boolean;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(flag: boolean): void;
}

export async function aboveThrong<T>(windows: readonly LayeredWindow[], show: () => Promise<T>): Promise<T> {
  const lowered = windows.filter((w) => !w.isDestroyed() && w.isAlwaysOnTop());
  for (const w of lowered) w.setAlwaysOnTop(false);
  try {
    return await show();
  } finally {
    for (const w of lowered) if (!w.isDestroyed()) w.setAlwaysOnTop(true);
  }
}
