import type { IFileAccessInfo } from '../abstractions/file-access-info.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IFileAccessInfo contract violation: ${message}`);
}

export interface FileAccessInfoContractEnv {
  make(): IFileAccessInfo;
  /** Whether this platform reports owners at all. Windows' Properties dialog is the OS's own, so it does not. */
  readonly reportsOwners: boolean;
  /** The stats of a file this user owns. */
  ownStats(): Promise<{ readonly uid: number; readonly gid: number; readonly mode: number }>;
  /** This user's account name. */
  readonly userName: string;
  /** A user and group id no account has. */
  readonly unusedId: number;
}

/**
 * Reusable contract for any `IFileAccessInfo` (067 FR-121, 070 FR-023, R11): owner, group and permissions, a name where
 * the system knows one and the number where it does not. In behaviour terms; rejects on the first violation.
 */
export async function runFileAccessInfoContract(env: FileAccessInfoContractEnv): Promise<void> {
  const subject = env.make();
  const stats = await env.ownStats();
  const own = await subject.read(stats);
  if (!env.reportsOwners) {
    assert(own === undefined, 'a platform that reports no owners must answer nothing');
    return;
  }
  assert(own !== undefined, 'a platform that reports owners must answer for a file this user owns');
  assert(own.owner === env.userName, `the owner must be this user's name; got ${JSON.stringify(own.owner)}`);
  assert(typeof own.group === 'string' && own.group.length > 0, `the group must be named; got ${JSON.stringify(own.group)}`);
  assert(/^[0-7]{4}$/.test(own.modeOctal ?? ''), `the mode must be four octal digits; got ${JSON.stringify(own.modeOctal)}`);
  assert(/^[-rwxsStT]{9}$/.test(own.modeSymbolic ?? ''), `the mode must be chmod's nine characters; got ${JSON.stringify(own.modeSymbolic)}`);

  const unknown = await subject.read({ uid: env.unusedId, gid: env.unusedId, mode: 0o644 });
  assert(unknown?.owner === String(env.unusedId), `an id no account has must show as its number; got ${JSON.stringify(unknown?.owner)}`);
  assert(unknown?.group === String(env.unusedId), `a group id no group has must show as its number; got ${JSON.stringify(unknown?.group)}`);
  assert(unknown?.modeOctal === '0644', 'the mode is the stat mode, whoever owns it');
}
