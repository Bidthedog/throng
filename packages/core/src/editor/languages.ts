/**
 * The language registry (016, FR-004) — 31 descriptors, pure data.
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
   * RESERVED (FR-002b). Exact-filename matching (`Dockerfile`, `.gitignore`) is a planned later
   * extension (#70). The shape is declared now so adding it is not a breaking change; it MUST be
   * empty in Part 1, which the registry test asserts.
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
 * The 31 targets of FR-001 — 17 programming languages, 6 markup/styling, 8 data/config/docs.
 *
 * `indent` appears ONLY where the language's established convention differs from the global
 * 2-space default (FR-018a): gofmt's tabs are non-negotiable, PEP 8 is 4 spaces, and so on. The
 * majority — JavaScript, TypeScript, JSON, YAML, HTML, CSS, Markdown… — inherit the default,
 * which is why 2 spaces IS the default.
 *
 * Makefile is deliberately absent: its tabs-are-mandatory convention is well known, but a Makefile
 * has no extension and exact-filename descriptors are out of scope in Part 1 (#70). Shipping an
 * override keyed to a language id nothing can resolve would be a default that never fires.
 */
export const LANGUAGES: readonly LanguageDescriptor[] = [
  // ---- Programming languages (17) ----
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
  { id: 'ruby', name: 'Ruby', extensions: ['.rb', '.rake', '.gemspec'] },
  { id: 'lua', name: 'Lua', extensions: ['.lua'] },
  { id: 'powershell', name: 'PowerShell', extensions: ['.ps1', '.psm1', '.psd1'], indent: FOUR_SPACES },
  { id: 'shell', name: 'Shell', extensions: ['.sh', '.bash', '.zsh'], indent: FOUR_SPACES },

  // ---- Markup & styling (6) ----
  { id: 'html', name: 'HTML', extensions: ['.html', '.htm'] },
  { id: 'css', name: 'CSS', extensions: ['.css'] },
  { id: 'sass', name: 'SASS/SCSS', extensions: ['.scss', '.sass'] },
  { id: 'less', name: 'Less', extensions: ['.less'] },
  { id: 'vue', name: 'Vue', extensions: ['.vue'] },
  { id: 'xml', name: 'XML', extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg'] },

  // ---- Data, config & documentation (8) ----
  { id: 'json', name: 'JSON', extensions: ['.json'] },
  { id: 'jsonc', name: 'JSON with Comments', extensions: ['.jsonc'] },
  { id: 'yaml', name: 'YAML', extensions: ['.yaml', '.yml'] },
  { id: 'toml', name: 'TOML', extensions: ['.toml'] },
  { id: 'ini', name: 'INI', extensions: ['.ini', '.cfg'] },
  { id: 'markdown', name: 'Markdown', extensions: ['.md', '.markdown'] },
  { id: 'sql', name: 'SQL', extensions: ['.sql'], indent: FOUR_SPACES },
  // Jupyter is its own descriptor, not an extension hung off JSON: it is one of FR-001's 31
  // targets and a user-selectable language. It is HIGHLIGHTED as JSON (FR-009) — that is a
  // property of the grammar loader, not of the registry.
  { id: 'jupyter', name: 'Jupyter Notebook', extensions: ['.ipynb'] },
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
