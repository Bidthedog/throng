/**
 * Single-instance guard (FR / Constitution "Single instance", research D6). The
 * application MUST run as one instance per user; a second launch while an instance
 * is running must not start a second instance. Kept as a tiny, app-injected helper
 * so it is unit-testable without Electron.
 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): void;
}

/**
 * Acquire the single-instance lock. Returns true for the primary instance (which
 * should proceed to create windows) and false for any secondary instance (which
 * is asked to quit). When primary, `onSecondInstance` fires if another launch is
 * attempted (used to focus/raise the existing window).
 */
export function acquireSingleInstance(app: SingleInstanceApp, onSecondInstance: () => void): boolean {
  const isPrimary = app.requestSingleInstanceLock();
  if (!isPrimary) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondInstance);
  return true;
}
