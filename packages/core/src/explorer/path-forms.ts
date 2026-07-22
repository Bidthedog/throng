/**
 * The four path renderings the "Copy Path" submenu offers (US9, #156): absolute vs relative × Windows
 * (`\`) vs Linux (`/`) slashes. Pure; no OS/DOM. Relative is relative to the project root.
 */
export interface PathForms {
  absWin: string;
  absLinux: string;
  relWin: string;
  relLinux: string;
}

const toLinux = (p: string): string => p.replace(/\\/g, '/');
const toWin = (p: string): string => p.replace(/\//g, '\\');

/**
 * Render an item's path (given the project root and the item's root-relative path) in all four
 * absolute/relative × slash-style forms. Separators are normalised, so a mixed-separator input
 * produces consistent output.
 */
export function pathForms(projectRoot: string, relPath: string): PathForms {
  const root = toLinux(projectRoot).replace(/\/+$/, '');
  const rel = toLinux(relPath).replace(/^\/+/, '');
  const absLinux = rel ? `${root}/${rel}` : root;
  return {
    absWin: toWin(absLinux),
    absLinux,
    relWin: toWin(rel),
    relLinux: rel,
  };
}
