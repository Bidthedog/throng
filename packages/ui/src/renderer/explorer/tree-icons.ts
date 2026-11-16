/**
 * Maps a file name to a theme icon token (004, T022, FR-005). The token is
 * resolved through the active theme's icon map so icons follow the theme and
 * stay a uniform size; an unknown extension falls back to the generic `file`.
 *
 * 069 FR-056 — every file and folder kind the default set draws has its names here: archives, scripts,
 * configuration, spreadsheets, databases, diffs, keys, audio, video, fonts, 3D models and packages, plus
 * the Git, settings and dependency folders. 069 FR-057 — each common programming language has its own key;
 * `fileCode` is the source file of any other language.
 */
import type { IconKey } from '@throng/core';

const kinds = (key: IconKey, extensions: readonly string[]): Record<string, IconKey> =>
  Object.fromEntries(extensions.map((ext) => [ext, key]));

const BY_EXTENSION: Record<string, IconKey> = {
  ...kinds('fileCode', [
    'vue', 'svelte', 'astro', 'xml', 'vb', 'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'elm', 'fs',
    'fsx', 'ml', 'zig', 'nim', 'jl', 'groovy', 'gradle', 'asm', 'm', 'mm', 'f90', 'pas', 'cob', 'v', 'sv', 'vhd',
  ]),
  ...kinds('fileC', ['c', 'h']),
  ...kinds('fileCpp', ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'ino']),
  ...kinds('fileCsharp', ['cs', 'csx']),
  ...kinds('fileJava', ['java', 'jsp']),
  ...kinds('fileJavaScript', ['js', 'jsx', 'mjs', 'cjs']),
  ...kinds('fileTypeScript', ['ts', 'tsx', 'mts', 'cts']),
  ...kinds('filePython', ['py', 'pyw', 'pyi', 'ipynb']),
  ...kinds('fileGo', ['go']),
  ...kinds('fileRust', ['rs']),
  ...kinds('fileRuby', ['rb', 'rake', 'gemspec', 'erb']),
  ...kinds('fileR', ['r', 'rmd']),
  ...kinds('fileLua', ['lua']),
  ...kinds('fileDart', ['dart']),
  ...kinds('fileSwift', ['swift']),
  ...kinds('fileScala', ['scala', 'sc', 'sbt']),
  ...kinds('fileKotlin', ['kt', 'kts']),
  ...kinds('filePhp', ['php', 'phtml']),
  ...kinds('fileSql', ['sql', 'psql', 'pgsql']),
  ...kinds('fileHtml', ['html', 'htm', 'xhtml']),
  ...kinds('fileCss', ['css', 'less']),
  ...kinds('fileSass', ['scss', 'sass']),
  ...kinds('filePowerShell', ['ps1', 'psm1', 'psd1']),
  ...kinds('fileJson', ['json']),
  ...kinds('fileMarkdown', ['md', 'markdown']),
  ...kinds('fileText', ['txt', 'log']),
  ...kinds('fileImage', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico']),
  ...kinds('fileArchive', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar']),
  ...kinds('fileShell', ['sh', 'bash', 'zsh', 'fish', 'ksh', 'bat', 'cmd']),
  ...kinds('fileConfig', ['yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties']),
  ...kinds('fileSpreadsheet', ['csv', 'tsv', 'xlsx', 'xls', 'ods']),
  ...kinds('fileDatabase', ['db', 'sqlite', 'sqlite3', 'mdb', 'accdb']),
  ...kinds('fileDiff', ['diff', 'patch']),
  ...kinds('fileKey', ['pem', 'key', 'crt', 'cer', 'pub', 'p12', 'pfx', 'gpg', 'asc']),
  ...kinds('fileAudio', ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']),
  ...kinds('fileVideo', ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']),
  ...kinds('fileFont', ['ttf', 'otf', 'woff', 'woff2']),
  ...kinds('fileModel', ['obj', 'stl', 'gltf', 'glb', 'fbx', '3mf']),
  ...kinds('filePackage', ['deb', 'rpm', 'nupkg', 'vsix', 'appimage', 'msi', 'dmg', 'pkg', 'snap', 'flatpak']),
};

/** Whole names with no telling extension — mostly dotfiles, whose one dot is not an extension. */
const BY_NAME: Record<string, IconKey> = {
  ...kinds('fileConfig', [
    '.editorconfig', '.gitignore', '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc', '.env',
    '.prettierrc', '.eslintrc', '.dockerignore',
  ]),
  ...kinds('fileShell', ['.bashrc', '.bash_profile', '.zshrc', '.profile']),
  ...kinds('fileRuby', ['gemfile', 'rakefile']),
};

/** Folders whose name says what they hold. Other folders draw `folder` or `folderOpen`. */
const FOLDER_BY_NAME: Record<string, IconKey> = {
  ...kinds('folderGit', ['.git']),
  ...kinds('folderConfig', ['.vscode', '.github', '.idea', '.config']),
  ...kinds('folderDependencies', ['node_modules', 'vendor', '.venv', 'venv']),
};

/** Theme icon token for a file by its name or extension (FR-005, 069 FR-056). */
export function fileIconToken(name: string): IconKey {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  // `.env.local`, `.env.production` and the like.
  if (lower.startsWith('.env.')) return 'fileConfig';
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return BY_EXTENSION[lower.slice(dot + 1)] ?? 'file';
}

/**
 * Theme icon token for a folder (069 FR-056): its kind when its name says it, the same whether open or
 * closed since the art has no open form; otherwise the open or closed folder.
 */
export function folderIconToken(name: string, open: boolean): IconKey {
  return FOLDER_BY_NAME[name.toLowerCase()] ?? (open ? 'folderOpen' : 'folder');
}
