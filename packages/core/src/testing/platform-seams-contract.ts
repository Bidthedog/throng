import type { ITrashRestore, IUserDirectories } from '../abstractions/platform-seams.js';

/**
 * Contract suites for the seams 062 adds, written in terms of behaviour, so a macOS implementation can run them
 * unchanged (FR-049). Pure-throw, in the style of the other suites here: they import nothing.
 */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Platform seam contract violation: ${message}`);
}

export function runUserDirectoriesContract(make: () => IUserDirectories): void {
  const d = make();
  for (const dev of [false, true]) {
    for (const path of [d.configRoot(dev), d.dataDir(dev)]) {
      assert(typeof path === 'string' && path.length > 0, `a folder must be named; got ${JSON.stringify(path)}`);
      assert(/^(?:[\\/]|[A-Za-z]:[\\/])/.test(path), `a folder must be absolute; got ${JSON.stringify(path)}`);
    }
  }
  assert(d.configRoot(true) !== d.configRoot(false), 'a dev run must keep settings apart from an installed one (FR-005)');
  assert(d.dataDir(true) !== d.dataDir(false), 'a dev run must keep data apart from an installed one (FR-005)');
  assert(d.configRoot(false) === d.configRoot(false), 'configRoot must be stable across calls');
}

export interface TrashRestoreContractEnv {
  make(): ITrashRestore;
  /** Put an item in this platform's trash, and return its original path. */
  trashed(): string;
  /** A path no deletion ever came from. */
  neverTrashed(): string;
  /** A path with an item in the trash and something new standing in its place. */
  occupied(): string;
  exists(path: string): boolean;
}

export async function runTrashRestoreContract(env: TrashRestoreContractEnv): Promise<void> {
  const subject = env.make();

  const path = env.trashed();
  await subject.restore(path, Date.now());
  assert(env.exists(path), 'restore must put the item back at its original path');

  let refused = false;
  try {
    await subject.restore(env.neverTrashed(), Date.now());
  } catch (error) {
    refused = error instanceof Error && error.message.length > 0;
  }
  assert(refused, 'restoring what is not in the trash must reject with a reason');

  const occupied = env.occupied();
  refused = false;
  try {
    await subject.restore(occupied, Date.now());
  } catch (error) {
    refused = error instanceof Error && error.message.length > 0;
  }
  assert(refused, 'restore must not replace what now stands at the original path');
}
