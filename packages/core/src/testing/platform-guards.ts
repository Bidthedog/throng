/**
 * A test that asserts one platform's behaviour says so, and says why (062 FR-042). The reason is mandatory, so a skip
 * can always be read back; `describe.skipIf(skipUnlessWindows('…'))` is the form.
 */
function requireReason(reason: string): void {
  if (reason.trim().length === 0) throw new Error('A platform skip must state its reason (062 FR-042).');
}

const nodePlatform = (): string =>
  (globalThis as { process?: { platform?: string } }).process?.platform ?? 'unknown';

/** True (skip) off Windows. `reason` says what Windows behaviour the test covers. */
export function skipUnlessWindows(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() !== 'win32';
}

/** True (skip) off Linux. `reason` says what Linux behaviour the test covers. */
export function skipUnlessLinux(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() !== 'linux';
}

export const isLinuxHost = (): boolean => nodePlatform() === 'linux';
export const isWindowsHost = (): boolean => nodePlatform() === 'win32';
