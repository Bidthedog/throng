import type { IVolumeRoots } from '../abstractions/platform-seams.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IVolumeRoots contract violation: ${message}`);
}

export interface VolumeRootsContractEnv {
  make(): IVolumeRoots;
  /** Two paths in one local folder, spelled as this platform spells them. */
  readonly localPaths: readonly [string, string];
  /** A path on a network share, where the platform can name one without mounting anything. */
  readonly networkPath?: string;
  /** A path on another local volume, where the machine has one. */
  readonly otherVolumePath?: string;
}

/**
 * Reusable contract for any `IVolumeRoots` (045 FR-121, 070 R11): which volume a path is on, so a check that may hang
 * is gated per volume. In behaviour terms; throws on the first violation.
 */
export function runVolumeRootsContract(env: VolumeRootsContractEnv): void {
  const subject = env.make();
  const [a, b] = env.localPaths;

  const root = subject.rootOf(a);
  assert(typeof root === 'string' && root.length > 0, `a path must have a root; got ${JSON.stringify(root)}`);
  assert(subject.rootOf(a) === root, 'the root of a path must be stable');
  assert(subject.rootOf(b) === root, `two paths in one folder must share a root; got ${JSON.stringify(root)} and ${JSON.stringify(subject.rootOf(b))}`);
  assert(subject.rootOf(root) === root, `a root must be its own root; got ${JSON.stringify(subject.rootOf(root))}`);
  assert(!subject.isNetwork(root), `a local folder's root must not be a network one: ${JSON.stringify(root)}`);

  if (env.networkPath !== undefined) {
    const share = subject.rootOf(env.networkPath);
    assert(share !== root, 'a network share must not share a root with a local folder');
    assert(subject.isNetwork(share), `a network share's root must be a network one: ${JSON.stringify(share)}`);
  }
  if (env.otherVolumePath !== undefined) {
    const other = subject.rootOf(env.otherVolumePath);
    assert(other !== root, `a path on another volume must have another root; both were ${JSON.stringify(root)}`);
    assert(subject.rootOf(other) === other, 'another volume’s root must be its own root');
  }
}
