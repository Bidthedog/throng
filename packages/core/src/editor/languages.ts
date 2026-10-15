/**
 * The language registry (016 FR-004, extended by 055) — 55 descriptors, pure data.
 *
 * This is the feature's open/closed extension point (Principle VIII): a new language is a new
 * descriptor here, and no editor code changes. The registry declares WHAT a language is — its id,
 * its name, the file suffixes it claims, and the indentation convention it overrides the global
 * default with. It deliberately says nothing about HOW to highlight it: the CodeMirror grammar
 * loaders live in the renderer, because a grammar is a DOM concern and core must stay free of one.
 *
 * No OS, no DOM, no I/O.
 */

/** Indentation convention a language overrides the global default with (FR-018a). */
export interface IndentProfile {
  style: 'tabs' | 'spaces';
  /** Columns per indent when the style is 'spaces'. */
  indentWidth: number;
  /** Columns a literal tab occupies on screen — rendering only, never content (FR-018e). */
  tabWidth: number;
}

/** One entry in the extensible language registry (FR-004). */
export interface LanguageDescriptor {
  /** Stable id, persisted as a document override. Never renamed once shipped (FR-005b). */
  id: string;
  /** Display name, shown in the picker and the status strip. */
  name: string;
  /**
   * Dot-prefixed suffixes this language claims, e.g. ['.ts', '.d.ts']. Many-to-one: a language
   * may claim many suffixes, but no suffix may be claimed by two languages (FR-004a).
   */
  extensions: readonly string[];
  /**
   * Whole-name matches (055 FR-002–FR-004), reserved by 016 FR-002b and filled by 055. Lower-case,
   * one of three forms: `dockerfile` (exact), `tsconfig.*.json` (one `*`, never across a separator),
   * `.vscode/settings.json` (the name inside that immediate folder). A filename match outranks the
   * user's extension mapping (055 FR-007). No two languages may claim entries one name could match
   * (FR-006), which the registry test proves.
   */
  filenames?: readonly string[];
  /** Set only where the community convention differs from the 2-space global default (FR-018a). */
  indent?: IndentProfile;
}

/**
 * Plain text is a first-class VALUE, not the absence of one (FR-004c/FR-011). It is selectable in
 * the picker and in the extension map, and choosing it TERMINATES the precedence chain — which is
 * why it is not a registry descriptor: it claims no extension and needs no grammar.
 */
export const PLAIN_TEXT_ID = 'plaintext';

/** Display name for {@link PLAIN_TEXT_ID}. */
export const PLAIN_TEXT_NAME = 'Plain Text';

const FOUR_SPACES: IndentProfile = { style: 'spaces', indentWidth: 4, tabWidth: 4 };
const TABS: IndentProfile = { style: 'tabs', indentWidth: 4, tabWidth: 4 };

/**
 * 55 languages: 016 FR-001's 31 targets and the 24 that 055 adds — 30 programming languages,
 * 6 markup/styling, 8 data/config/docs, 11 build, tooling and environment files.
 *
 * `indent` appears ONLY where the language's established convention differs from the global
 * 2-space default (FR-018a): gofmt's tabs are non-negotiable, PEP 8 is 4 spaces, and so on. The
 * majority — JavaScript, TypeScript, JSON, YAML, HTML, CSS, Markdown… — inherit the default,
 * which is why 2 spaces IS the default.
 *
 * Makefile is deliberately absent: its tabs-are-mandatory convention is well known, and since 055 a
 * Makefile could be matched by name — but no grammar ships for it, so a Makefile language would be
 * plain text under another name.
 */
export const LANGUAGES: readonly LanguageDescriptor[] = [
  // ---- Programming languages (30: 17 from 016, 13 from 055) ----
  { id: 'csharp', name: 'C#', extensions: ['.cs', '.csx'], indent: FOUR_SPACES },
  { id: 'c', name: 'C', extensions: ['.c'], indent: FOUR_SPACES },
  {
    id: 'cpp',
    name: 'C++',
    // `.h` is genuinely ambiguous between C and C++. The tie is decided ONCE, by fiat (FR-004a),
    // and a user who disagrees remaps it in one line of settings (`languageByExtension`).
    extensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h'],
    indent: FOUR_SPACES,
  },
  { id: 'rust', name: 'Rust', extensions: ['.rs'], indent: FOUR_SPACES },
  { id: 'go', name: 'Go', extensions: ['.go'], indent: TABS },
  { id: 'python', name: 'Python', extensions: ['.py', '.pyw', '.pyi'], indent: FOUR_SPACES },
  { id: 'javascript', name: 'JavaScript', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  { id: 'typescript', name: 'TypeScript', extensions: ['.ts', '.d.ts', '.mts', '.cts', '.tsx'] },
  { id: 'java', name: 'Java', extensions: ['.java'], indent: FOUR_SPACES },
  { id: 'kotlin', name: 'Kotlin', extensions: ['.kt', '.kts'], indent: FOUR_SPACES },
  { id: 'swift', name: 'Swift', extensions: ['.swift'], indent: FOUR_SPACES },
  { id: 'dart', name: 'Dart', extensions: ['.dart'] },
  { id: 'php', name: 'PHP', extensions: ['.php', '.phtml'], indent: FOUR_SPACES },
  { id: 'ruby', name: 'Ruby', extensions: ['.rb', '.rake', '.gemspec'], filenames: ['gemfile', 'rakefile', 'vagrantfile'] },
  { id: 'lua', name: 'Lua', extensions: ['.lua'] },
  { id: 'powershell', name: 'PowerShell', extensions: ['.ps1', '.psm1', '.psd1'], indent: FOUR_SPACES },
  { id: 'shell', name: 'Shell', extensions: ['.sh', '.bash', '.zsh'], indent: FOUR_SPACES },
  { id: 'batch', name: 'Batch', extensions: ['.bat', '.cmd'], indent: FOUR_SPACES },
  { id: 'groovy', name: 'Groovy', extensions: ['.groovy', '.gradle'], filenames: ['jenkinsfile'], indent: FOUR_SPACES },
  { id: 'fsharp', name: 'F#', extensions: ['.fs', '.fsx', '.fsi'], indent: FOUR_SPACES },
  { id: 'vb', name: 'Visual Basic', extensions: ['.vb'], indent: FOUR_SPACES },
  { id: 'vbscript', name: 'VBScript', extensions: ['.vbs'], indent: FOUR_SPACES },
  { id: 'scala', name: 'Scala', extensions: ['.scala', '.sc'], indent: FOUR_SPACES },
  { id: 'perl', name: 'Perl', extensions: ['.pl', '.pm'], indent: FOUR_SPACES },
  { id: 'r', name: 'R', extensions: ['.r'] },
  { id: 'haskell', name: 'Haskell', extensions: ['.hs'], indent: FOUR_SPACES },
  { id: 'elm', name: 'Elm', extensions: ['.elm'], indent: FOUR_SPACES },
  { id: 'erlang', name: 'Erlang', extensions: ['.erl', '.hrl'], indent: FOUR_SPACES },
  { id: 'clojure', name: 'Clojure', extensions: ['.clj', '.cljs', '.cljc', '.edn'] },
  { id: 'julia', name: 'Julia', extensions: ['.jl'], indent: FOUR_SPACES },

  // ---- Markup & styling (6) ----
  {
    id: 'html',
    name: 'HTML',
    // Razor, Svelte and Astro are HTML with embedded code. The markup highlights; the embedded parts
    // read as plain text rather than errors — approximate, and better than none (055 FR-010).
    extensions: ['.html', '.htm', '.cshtml', '.razor', '.svelte', '.astro'],
  },
  { id: 'css', name: 'CSS', extensions: ['.css'] },
  { id: 'sass', name: 'SASS/SCSS', extensions: ['.scss', '.sass'] },
  { id: 'less', name: 'Less', extensions: ['.less'] },
  { id: 'vue', name: 'Vue', extensions: ['.vue'] },
  {
    id: 'xml',
    name: 'XML',
    extensions: [
      '.xml', '.xsd', '.xsl', '.xslt', '.svg',
      // .NET project, build, resource and UI files are XML under another name (055 FR-010).
      '.csproj', '.fsproj', '.vbproj', '.props', '.targets', '.nuspec', '.resx', '.config', '.xaml', '.slnx',
      '.ps1xml',
    ],
  },

  // ---- Data, config & documentation (8) ----
  { id: 'json', name: 'JSON', extensions: ['.json', '.webmanifest'] },
  {
    id: 'jsonc',
    name: 'JSON with Comments',
    extensions: ['.jsonc', '.json5', '.code-workspace'],
    // Files whose tools accept comments although the name ends `.json` (055 FR-009). Matched by NAME,
    // so they outrank `.json` → JSON, which would mark every comment in them as an error.
    filenames: [
      'tsconfig.json', 'tsconfig.*.json', 'jsconfig.json', '.eslintrc.json', '.babelrc', '.swcrc',
      'devcontainer.json', '.devcontainer.json',
      '.vscode/settings.json', '.vscode/launch.json', '.vscode/tasks.json', '.vscode/extensions.json',
    ],
  },
  { id: 'yaml', name: 'YAML', extensions: ['.yaml', '.yml'] },
  { id: 'toml', name: 'TOML', extensions: ['.toml'] },
  { id: 'ini', name: 'INI', extensions: ['.ini', '.cfg', '.properties'], filenames: ['.editorconfig', '.npmrc', '.gitconfig'] },
  // `.mdx` is Markdown with JSX: the prose highlights, the JSX does not (055 FR-010, approximate).
  { id: 'markdown', name: 'Markdown', extensions: ['.md', '.markdown', '.mdx'] },
  { id: 'sql', name: 'SQL', extensions: ['.sql'], indent: FOUR_SPACES },
  // Jupyter is its own descriptor, not an extension hung off JSON: it is one of FR-001's 31
  // targets and a user-selectable language. It is HIGHLIGHTED as JSON (FR-009) — that is a
  // property of the grammar loader, not of the registry.
  { id: 'jupyter', name: 'Jupyter Notebook', extensions: ['.ipynb'] },

  // ---- Build, tooling & environment files (11, 055) ----
  // Most of these are known by NAME rather than extension, which is what 055's filename rung is for.
  // A trailing `*` names a variant (`Dockerfile.dev`, `.env.local`) and yields to a known extension
  // (`Dockerfile.md` is Markdown, FR-003a).
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    extensions: ['.dockerfile'],
    filenames: ['dockerfile', 'containerfile', 'dockerfile.*'],
  },
  { id: 'cmake', name: 'CMake', extensions: ['.cmake'], filenames: ['cmakelists.txt'] },
  { id: 'diff', name: 'Diff', extensions: ['.diff', '.patch'] },
  { id: 'protobuf', name: 'Protocol Buffers', extensions: ['.proto'] },
  { id: 'http', name: 'HTTP requests', extensions: ['.http', '.rest'] },
  { id: 'gherkin', name: 'Gherkin', extensions: ['.feature'] },
  { id: 'jinja', name: 'Jinja', extensions: ['.j2', '.jinja', '.jinja2'] },
  { id: 'nsis', name: 'NSIS', extensions: ['.nsi', '.nsh'] },
  { id: 'nginx', name: 'nginx', extensions: [], filenames: ['nginx.conf'] },
  // `.envrc` is direnv's shell script, not an environment file: neither entry matches it.
  { id: 'dotenv', name: 'Dotenv', extensions: [], filenames: ['.env', '.env.*'] },
  {
    id: 'ignore',
    name: 'Ignore file',
    extensions: [],
    // A fixed list, not `.*ignore`: these all use gitignore syntax, and a catch-all would claim
    // files in other formats that merely end in "ignore" (055, clarified 2026-10-14).
    filenames: [
      '.gitignore', '.dockerignore', '.gitattributes', '.npmignore', '.prettierignore', '.eslintignore',
      '.stylelintignore', '.vscodeignore',
    ],
  },
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

/** The descriptor for `id`, or undefined when the registry does not know it (FR-005b). */
/**
 * The shipped per-language indentation map (016, FR-018/FR-022) — DERIVED from the registry above,
 * never written out a second time.
 *
 * The registry is where a language's convention is declared, so the setting's shipped default is
 * built from it. Hand-maintaining a parallel copy in the settings defaults would be two lists to
 * keep in step, and the first one to drift would silently indent Go with spaces.
 */
export const SHIPPED_INDENT_BY_LANGUAGE: Readonly<Record<string, IndentProfile>> = Object.freeze(
  Object.fromEntries([
    ...LANGUAGES.filter((l) => l.indent !== undefined).map((l) => [l.id, { ...l.indent! }]),
    // Plain text has no registry descriptor, but it still gets a convention: four spaces. A file
    // that already indents (with tabs or a different width) overrules this, per effectiveIndent.
    [PLAIN_TEXT_ID, { ...FOUR_SPACES }],
  ]),
);

export function languageById(id: string): LanguageDescriptor | undefined {
  return BY_ID.get(id);
}

/** The display name for a language id — including plain text, which is not a descriptor. */
export function languageName(id: string): string {
  if (id === PLAIN_TEXT_ID) return PLAIN_TEXT_NAME;
  return BY_ID.get(id)?.name ?? id;
}

/** True when `id` names something the editor can actually render — plain text included. */
export function isKnownLanguage(id: string): boolean {
  return id === PLAIN_TEXT_ID || BY_ID.has(id);
}
