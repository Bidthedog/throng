/**
 * The four path renderings the "Copy Path" submenu offers (US9, #156): absolute vs relative × Windows
 * (`C:\git\test.txt`) vs POSIX (`/c/git/test.txt`) form. Pure; no OS/DOM. Relative is relative to the
 * project root.
 *
 * "POSIX" here is the MSYS2 / Git-for-Windows convention a throng Git Bash terminal actually accepts:
 * a drive `C:` becomes a lowercase `/c` root and separators are forward slashes. (It is NOT the WSL
 * `/mnt/c` form nor Cygwin's `/cygdrive/c`; throng ships Git Bash.) A relative POSIX path carries no
 * drive, so it is just the forward-slash relative path.
 */
export interface PathForms {
  /** `C:\git\test.txt` — backslashes, drive letter kept. */
  absWin: string;
  /** `/c/git/test.txt` — MSYS/Git Bash: `/<drive>/…`, forward slashes. */
  absPosix: string;
  /** `git\test.txt` — relative, backslashes. */
  relWin: string;
  /** `git/test.txt` — relative, forward slashes (no drive). */
  relPosix: string;
}

const toLinux = (p: string): string => p.replace(/\\/g, '/');
const toWin = (p: string): string => p.replace(/\//g, '\\');
/** `C:/git/test.txt` → `/c/git/test.txt` (MSYS/Git Bash). Leaves a driveless path untouched. */
const toPosix = (p: string): string => p.replace(/^([A-Za-z]):\//, (_m, d: string) => `/${d.toLowerCase()}/`);

/**
 * Render an item's path (given the project root and the item's root-relative path) in all four
 * absolute/relative × slash-style forms. Separators are normalised, so a mixed-separator input
 * produces consistent output.
 */
export function pathForms(projectRoot: string, relPath: string): PathForms {
  const root = toLinux(projectRoot).replace(/\/+$/, '');
  const rel = toLinux(relPath).replace(/^\/+/, '');
  const absSlashed = rel ? `${root}/${rel}` : root;
  return {
    absWin: toWin(absSlashed),
    absPosix: toPosix(absSlashed),
    relWin: toWin(rel),
    relPosix: rel,
  };
}
