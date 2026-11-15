import { logExpected, type IFileSystem } from '@throng/core';

/**
 * The confinement roots with every symlink in them resolved, so the rule compares a real path with real roots
 * (004 SC-011, 070 FR-020). The candidate is always resolved before the rule sees it; a root left as the user gave it
 * refuses every file of a project reached through a link, which on macOS is any project under `/tmp` or `/var`
 * (`/private/tmp`, `/private/var`). A root that cannot be resolved (gone, or not yet made) is kept as given, which is
 * what the rule saw before.
 */
export async function realRoots(
  fs: Pick<IFileSystem, 'realpath'>,
  roots: { ownerRoot: string | null; allProjectRoots: readonly string[] },
): Promise<{ ownerRoot: string | null; allProjectRoots: string[] }> {
  const real = async (root: string): Promise<string> => {
    try {
      return await fs.realpath(root);
    } catch (error) {
      logExpected('real-roots: resolve a project root', 'a root that is gone or not yet made is compared as given', error);
      return root;
    }
  };
  const [ownerRoot, ...allProjectRoots] = await Promise.all([
    roots.ownerRoot === null ? Promise.resolve(null) : real(roots.ownerRoot),
    ...roots.allProjectRoots.map(real),
  ]);
  return { ownerRoot, allProjectRoots: allProjectRoots as string[] };
}
