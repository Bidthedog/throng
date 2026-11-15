import type { IFileAttributes } from '../abstractions/file-attributes.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IFileAttributes contract violation: ${message}`);
}

export interface FileAttributesContractEnv {
  make(): IFileAttributes;
  /** A fresh file this user can write, and that the platform shows. */
  plainFile(): Promise<string>;
  /** A fresh file made read-only the platform's way. */
  readOnlyFile(): Promise<string>;
  /** A fresh file made hidden the platform's way (a dot name, or the hidden flag). */
  hiddenFile(): Promise<string>;
  /** A path where nothing is. */
  missingPath(): string;
}

/**
 * Reusable contract for any `IFileAttributes` (067 FR-046, 070 FR-023, R11): read-only and hidden in the platform's own
 * terms, and never a throw. In behaviour terms; rejects on the first violation.
 */
export async function runFileAttributesContract(env: FileAttributesContractEnv): Promise<void> {
  const subject = env.make();
  const flags = ['readOnly', 'hidden', 'system', 'archive', 'junction'] as const;

  const plain = await subject.read(await env.plainFile());
  for (const flag of flags) assert(typeof plain[flag] === 'boolean', `${flag} must be a boolean; got ${JSON.stringify(plain)}`);
  assert(!plain.readOnly, 'a file this user can write must not be read-only');
  assert(!plain.hidden, 'an ordinary file must not be hidden');

  assert((await subject.read(await env.readOnlyFile())).readOnly, 'a read-only file must be read as read-only');
  assert((await subject.read(await env.hiddenFile())).hidden, 'a hidden file must be read as hidden');

  const missing = await subject.read(env.missingPath());
  for (const flag of flags) assert(typeof missing[flag] === 'boolean', `a missing path must still answer booleans; got ${JSON.stringify(missing)}`);
  assert(!missing.readOnly, 'a missing path has no attributes to report');
}
