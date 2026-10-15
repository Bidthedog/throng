/**
 * Detection (016 FR-002/FR-002b, widened by 055 FR-001–FR-008).
 *
 * Detection reads the NAME and nothing else — never content. 016 matched extensions only: the
 * longest declared suffix wins (`types.d.ts` is TypeScript declarations, not merely `.ts`),
 * case-insensitively. 055 adds a rung in front of it: a whole filename, a single-wildcard pattern,
 * or a name inside a named folder. A name no descriptor claims and with no extension is still
 * plain text.
 */
import { describe, expect, it } from 'vitest';
import { createFilenameMatcher, detectLanguage, matchFilename } from '../../src/editor/language-detect.js';
import { PLAIN_TEXT_ID, type LanguageDescriptor } from '../../src/editor/languages.js';

describe('detectLanguage (FR-002)', () => {
  it('matches a simple extension', () => {
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('package.json')).toBe('json');
  });

  it('prefers the LONGEST declared suffix (FR-002b)', () => {
    expect(detectLanguage('types.d.ts')).toBe('typescript');
    // Both `.d.ts` and `.ts` are declared by TypeScript; the point is the longest one is
    // consulted first, which is what lets a future language claim `.d.ts` alone.
    expect(detectLanguage('index.ts')).toBe('typescript');
  });

  it('matches case-insensitively', () => {
    expect(detectLanguage('README.MD')).toBe('markdown');
    expect(detectLanguage('Program.CS')).toBe('csharp');
  });

  it('gives a name no descriptor claims, with NO extension, plain text (016 FR-002b remainder)', () => {
    expect(detectLanguage('Makefile')).toBe(PLAIN_TEXT_ID);
    expect(detectLanguage('LICENSE')).toBe(PLAIN_TEXT_ID);
  });

  it('treats an unclaimed leading-dot-only name as having no extension (016 FR-002b remainder)', () => {
    expect(detectLanguage('.bazelignore')).toBe(PLAIN_TEXT_ID);
    expect(detectLanguage('.envrc')).toBe(PLAIN_TEXT_ID);
  });

  it('gives an unknown extension plain text, never an error', () => {
    expect(detectLanguage('archive.zzz')).toBe(PLAIN_TEXT_ID);
  });

  it('reads only the filename of a full path', () => {
    expect(detectLanguage('C:\\src\\deep\\main.go')).toBe('go');
    expect(detectLanguage('/home/u/src/main.go')).toBe('go');
  });

  it('never inspects content — a shebang decides nothing (FR-002)', () => {
    // detectLanguage takes a filename and nothing else: there is no parameter through
    // which content COULD reach it. That is the guarantee, expressed as a type.
    expect(detectLanguage.length).toBe(1);
    expect(detectLanguage('script')).toBe(PLAIN_TEXT_ID);
  });

  it('consults the filename rung before the extension rung (055 FR-007)', () => {
    // Whatever the registry's filename entries are, detection must agree with matchFilename
    // whenever it claims a name, and fall back to the extension otherwise.
    for (const name of ['tsconfig.json', 'Dockerfile', '.env', 'main.rs', 'notes.txt']) {
      const byName = matchFilename(name);
      if (byName !== undefined) expect(detectLanguage(name), name).toBe(byName);
    }
    expect(matchFilename('main.rs')).toBeUndefined();
    expect(detectLanguage('main.rs')).toBe('rust');
  });
});

describe('configuration files that allow comments (055 US1, FR-009)', () => {
  it.each([
    'tsconfig.json',
    'tsconfig.build.json',
    'jsconfig.json',
    '.eslintrc.json',
    '.babelrc',
    '.swcrc',
    'devcontainer.json',
    '.devcontainer.json',
    'C:\\p\\.vscode\\settings.json',
    'C:\\p\\.vscode\\launch.json',
    '/p/.vscode/tasks.json',
    '/p/.vscode/extensions.json',
  ])('opens %s as JSON with Comments', (name) => {
    expect(detectLanguage(name)).toBe('jsonc');
  });

  it('leaves every other .json file as strict JSON', () => {
    expect(detectLanguage('package.json')).toBe('json');
    expect(detectLanguage('C:\\p\\launch.json')).toBe('json');
    expect(detectLanguage('C:\\p\\.vscode\\cspell.json')).toBe('json');
  });
});

describe('files known by name (055 US2, FR-009)', () => {
  it.each([
    ['.env', 'dotenv'],
    ['.env.local', 'dotenv'],
    ['.env.development', 'dotenv'],
    ['.env.production.local', 'dotenv'],
    ['Dockerfile', 'dockerfile'],
    ['dockerfile', 'dockerfile'],
    ['Containerfile', 'dockerfile'],
    ['Dockerfile.dev', 'dockerfile'],
    ['api.Dockerfile', 'dockerfile'],
    ['build.dockerfile', 'dockerfile'],
    ['.gitignore', 'ignore'],
    ['.dockerignore', 'ignore'],
    ['.gitattributes', 'ignore'],
    ['.npmignore', 'ignore'],
    ['.prettierignore', 'ignore'],
    ['.eslintignore', 'ignore'],
    ['.stylelintignore', 'ignore'],
    ['.vscodeignore', 'ignore'],
    ['.editorconfig', 'ini'],
    ['.npmrc', 'ini'],
    ['.gitconfig', 'ini'],
    ['CMakeLists.txt', 'cmake'],
    ['Jenkinsfile', 'groovy'],
    ['Gemfile', 'ruby'],
    ['GEMFILE', 'ruby'],
    ['Rakefile', 'ruby'],
    ['Vagrantfile', 'ruby'],
    ['nginx.conf', 'nginx'],
  ])('opens %s as %s', (name, id) => {
    expect(detectLanguage(name)).toBe(id);
  });

  it('leaves an ignore file nobody listed as plain text (FR-009 fixed list)', () => {
    expect(detectLanguage('.bazelignore')).toBe(PLAIN_TEXT_ID);
  });

  it('lets a known extension beat a trailing wildcard in the shipped registry (FR-003a)', () => {
    expect(detectLanguage('.env.json')).toBe('json');
    expect(detectLanguage('.env.sh')).toBe('shell');
    expect(detectLanguage('Dockerfile.md')).toBe('markdown');
  });
});

describe('more extensions for languages throng already highlights (055 US3, FR-010)', () => {
  it.each([
    ...['.csproj', '.fsproj', '.vbproj', '.props', '.targets', '.nuspec', '.resx', '.config', '.xaml', '.slnx', '.ps1xml'].map(
      (ext) => [`file${ext}`, 'xml'] as const,
    ),
    ['settings.json5', 'jsonc'],
    ['throng.code-workspace', 'jsonc'],
    ['site.webmanifest', 'json'],
    ['page.mdx', 'markdown'],
    ['Index.cshtml', 'html'],
    ['App.razor', 'html'],
    ['Button.svelte', 'html'],
    ['index.astro', 'html'],
    ['log4j.properties', 'ini'],
  ])('opens %s as %s', (name, id) => {
    expect(detectLanguage(name)).toBe(id);
  });

  it('lets an extension claimed later still beat a trailing wildcard (FR-003a)', () => {
    expect(detectLanguage('.env.config')).toBe('xml');
  });
});

describe('languages from grammars throng already ships (055 US4, FR-011)', () => {
  it.each([
    ['fix.diff', 'diff'],
    ['fix.patch', 'diff'],
    ['api.proto', 'protobuf'],
    ['deps.cmake', 'cmake'],
    ['Build.groovy', 'groovy'],
    ['build.gradle', 'groovy'],
    ['Program.fs', 'fsharp'],
    ['script.fsx', 'fsharp'],
    ['Sig.fsi', 'fsharp'],
    ['Module.vb', 'vb'],
    ['setup.vbs', 'vbscript'],
    ['Main.scala', 'scala'],
    ['worksheet.sc', 'scala'],
    ['tool.pl', 'perl'],
    ['Lib.pm', 'perl'],
    ['analysis.r', 'r'],
    ['analysis.R', 'r'],
    ['Main.hs', 'haskell'],
    ['Main.elm', 'elm'],
    ['server.erl', 'erlang'],
    ['records.hrl', 'erlang'],
    ['core.clj', 'clojure'],
    ['app.cljs', 'clojure'],
    ['shared.cljc', 'clojure'],
    ['config.edn', 'clojure'],
    ['solve.jl', 'julia'],
    ['requests.http', 'http'],
    ['requests.rest', 'http'],
    ['login.feature', 'gherkin'],
    ['page.j2', 'jinja'],
    ['page.jinja', 'jinja'],
    ['page.jinja2', 'jinja'],
    ['installer.nsi', 'nsis'],
    ['macros.nsh', 'nsis'],
  ])('opens %s as %s', (name, id) => {
    expect(detectLanguage(name)).toBe(id);
  });

  it('keeps Kotlin build scripts as Kotlin — `.gradle.kts` ends in `.kts`, not `.gradle`', () => {
    expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
  });
});

describe('Windows batch files (055 US5, FR-015)', () => {
  it.each(['build.bat', 'build.cmd', 'BUILD.CMD'])('opens %s as Batch', (name) => {
    expect(detectLanguage(name)).toBe('batch');
  });
});

/**
 * The matcher against a FIXTURE registry, so every form and rule is proven independently of
 * which names the shipped registry happens to claim.
 */
describe('filename matcher (055 FR-002–FR-005, FR-003a, FR-008)', () => {
  const fixture: readonly LanguageDescriptor[] = [
    { id: 'jsonc', name: 'JSONC', extensions: ['.jsonc'], filenames: ['tsconfig.json', 'tsconfig.*.json', '.vscode/launch.json'] },
    { id: 'json', name: 'JSON', extensions: ['.json'] },
    { id: 'markdown', name: 'Markdown', extensions: ['.md'] },
    { id: 'dotenv', name: 'Dotenv', extensions: [], filenames: ['.env', '.env.*'] },
    { id: 'docker', name: 'Dockerfile', extensions: ['.dockerfile'], filenames: ['dockerfile', 'dockerfile.*'] },
    { id: 'ruby', name: 'Ruby', extensions: ['.rb'], filenames: ['gemfile'] },
    { id: 'shell', name: 'Shell', extensions: ['.sh'] },
  ];
  const match = createFilenameMatcher(fixture);

  it('matches an exact name, case-insensitively (FR-002, FR-005)', () => {
    expect(match('Gemfile')).toBe('ruby');
    expect(match('GEMFILE')).toBe('ruby');
    expect(match('Dockerfile')).toBe('docker');
    expect(match('.env')).toBe('dotenv');
  });

  it('matches a pattern with the wildcard in the middle (FR-003)', () => {
    expect(match('tsconfig.build.json')).toBe('jsonc');
    expect(match('tsconfig.app.spec.json')).toBe('jsonc');
    expect(match('tsconfig.json')).toBe('jsonc');
  });

  it('matches a pattern with the wildcard at the end (FR-003)', () => {
    expect(match('.env.local')).toBe('dotenv');
    expect(match('.env.production.local')).toBe('dotenv');
    expect(match('Dockerfile.dev')).toBe('docker');
  });

  it('never lets a wildcard cross a folder separator (FR-003)', () => {
    // Only the basename is matched; the folder `tsconfig.x` cannot satisfy `tsconfig.*.json`.
    expect(match('C:\\p\\tsconfig.x\\y.json')).toBeUndefined();
    expect(match('/p/.env.d/readme')).toBeUndefined();
  });

  it('lets a known extension beat a TRAILING wildcard (FR-003a)', () => {
    expect(match('.env.json')).toBeUndefined();
    expect(match('.env.sh')).toBeUndefined();
    expect(match('Dockerfile.md')).toBeUndefined();
    // …but not an unclaimed one, and not a fixed-ending pattern.
    expect(match('.env.example')).toBe('dotenv');
    expect(match('tsconfig.base.json')).toBe('jsonc');
  });

  it('matches a folder-qualified name only inside that folder, whatever the separators (FR-004)', () => {
    expect(match('C:\\p\\.vscode\\launch.json')).toBe('jsonc');
    expect(match('/home/u/p/.vscode/launch.json')).toBe('jsonc');
    expect(match('C:\\p/.vscode\\launch.json')).toBe('jsonc');
    expect(match('C:\\P\\.VSCode\\Launch.JSON')).toBe('jsonc');
    expect(match('C:\\p\\launch.json')).toBeUndefined();
    expect(match('launch.json')).toBeUndefined();
  });

  it('tries exact and folder-qualified entries before patterns (FR-008)', () => {
    const tiered = createFilenameMatcher([
      { id: 'a', name: 'A', extensions: [], filenames: ['build.*'] },
      { id: 'b', name: 'B', extensions: [], filenames: ['build.gradle'] },
    ]);
    expect(tiered('build.gradle')).toBe('b');
    expect(tiered('build.sbt')).toBe('a');
  });

  it('claims nothing it was not told to', () => {
    expect(match('.envrc')).toBeUndefined();
    expect(match('LICENSE')).toBeUndefined();
    expect(match('main.rs')).toBeUndefined();
    expect(match('')).toBeUndefined();
  });
});
