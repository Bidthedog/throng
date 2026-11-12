/**
 * The folder a launch asks to open, as an absolute path (067 FR-022, FR-023). OS-free, so the launching process
 * resolves a relative path against its own working directory before anything reaches a running instance.
 */
export function parseLaunchFolder(argv: readonly string[], cwd: string, packaged: boolean): string | null {
  // A development launch is `electron [switches] <app entry> [folder]`: the first positional is the entry.
  const positionals = argv.slice(1).filter((arg) => arg !== '' && !arg.startsWith('-'));
  const positional = positionals[packaged ? 0 : 1];
  if (positional === undefined) return null;
  const windows = cwd.includes('\\') || /^[A-Za-z]:/.test(cwd);
  if (isAbsolute(positional, windows)) return positional;
  return join(cwd, positional, windows);
}

function isAbsolute(path: string, windows: boolean): boolean {
  return windows ? /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') : path.startsWith('/');
}

function join(cwd: string, relative: string, windows: boolean): string {
  const separator = windows ? '\\' : '/';
  const parts = cwd.split(windows ? /[\\/]/ : '/').filter((part, index) => part !== '' || index === 0);
  for (const part of relative.split(windows ? /[\\/]/ : '/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join(separator);
  return joined === '' ? separator : joined;
}
