import { describe, expect, it } from 'vitest';
import { ICON_KEYS, type IconKey } from '@throng/core';
import { fileIconToken, folderIconToken } from '../../src/renderer/explorer/tree-icons.js';

/**
 * 069 FR-056, FR-057 — which icon the tree draws for a file or folder, from its name alone. Every file and
 * folder kind the default set draws is reached from at least one name; the table is the representative
 * name of each.
 */
const FILES: ReadonlyArray<readonly [string, IconKey]> = [
  ['notes', 'file'],
  ['data.unknownext', 'file'],
  ['App.vue', 'fileCode'],
  ['package.json', 'fileJson'],
  ['README.md', 'fileMarkdown'],
  ['build.log', 'fileText'],
  ['logo.PNG', 'fileImage'],
  ['release.tar.gz', 'fileArchive'],
  ['deploy.sh', 'fileShell'],
  ['.bashrc', 'fileShell'],
  ['compose.yaml', 'fileConfig'],
  ['.gitignore', 'fileConfig'],
  ['.env.local', 'fileConfig'],
  ['report.csv', 'fileSpreadsheet'],
  ['app.sqlite', 'fileDatabase'],
  ['fix.patch', 'fileDiff'],
  ['id_ed25519.pub', 'fileKey'],
  ['theme.mp3', 'fileAudio'],
  ['demo.mp4', 'fileVideo'],
  ['Inter.woff2', 'fileFont'],
  ['part.stl', 'fileModel'],
  ['throng.deb', 'filePackage'],
  ['main.c', 'fileC'],
  ['vector.hpp', 'fileCpp'],
  ['Program.cs', 'fileCsharp'],
  ['Main.java', 'fileJava'],
  ['index.mjs', 'fileJavaScript'],
  ['app.tsx', 'fileTypeScript'],
  ['setup.py', 'filePython'],
  ['main.go', 'fileGo'],
  ['lib.rs', 'fileRust'],
  ['Gemfile', 'fileRuby'],
  ['analysis.R', 'fileR'],
  ['init.lua', 'fileLua'],
  ['main.dart', 'fileDart'],
  ['App.swift', 'fileSwift'],
  ['Build.scala', 'fileScala'],
  ['build.gradle.kts', 'fileKotlin'],
  ['index.php', 'filePhp'],
  ['schema.sql', 'fileSql'],
  ['index.html', 'fileHtml'],
  ['site.css', 'fileCss'],
  ['site.scss', 'fileSass'],
  ['Install.ps1', 'filePowerShell'],
];

describe('the tree’s file icons (069 FR-056, FR-057)', () => {
  it.each(FILES)('%s draws %s', (name, key) => {
    expect(fileIconToken(name)).toBe(key);
  });

  it('reaches every file kind in the icon set from some name', () => {
    const fileKinds = ICON_KEYS.filter((k) => /^file[A-Z]/.test(k) && k !== 'fileImage') as IconKey[];
    const reached = new Set(FILES.map(([, key]) => key));
    expect(fileKinds.filter((k) => !reached.has(k))).toEqual([]);
  });
});

describe('the tree’s folder icons (069 FR-056)', () => {
  it.each([
    ['.git', 'folderGit'],
    ['.vscode', 'folderConfig'],
    ['.github', 'folderConfig'],
    ['node_modules', 'folderDependencies'],
    ['.venv', 'folderDependencies'],
  ] as const)('%s draws %s, open or closed', (name, key) => {
    expect(folderIconToken(name, false)).toBe(key);
    expect(folderIconToken(name, true)).toBe(key);
  });

  it('draws any other folder open or closed', () => {
    expect(folderIconToken('src', false)).toBe('folder');
    expect(folderIconToken('src', true)).toBe('folderOpen');
  });
});
