/**
 * Maps a file name to a theme icon token (004, T022, FR-005). The token is
 * resolved through the active theme's icon map so icons follow the theme and
 * stay a uniform size; an unknown extension falls back to the generic `file`.
 */
const BY_EXTENSION: Record<string, string> = {
  ts: 'fileCode',
  tsx: 'fileCode',
  js: 'fileCode',
  jsx: 'fileCode',
  mjs: 'fileCode',
  cjs: 'fileCode',
  json: 'fileJson',
  md: 'fileMarkdown',
  markdown: 'fileMarkdown',
  txt: 'fileText',
  log: 'fileText',
  png: 'fileImage',
  jpg: 'fileImage',
  jpeg: 'fileImage',
  gif: 'fileImage',
  svg: 'fileImage',
  webp: 'fileImage',
  ico: 'fileImage',
};

/** Theme icon token for a file by its extension (FR-005). */
export function fileIconToken(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  const ext = name.slice(dot + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? 'file';
}
