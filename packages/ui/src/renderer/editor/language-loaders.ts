/**
 * Grammar loaders (016, FR-001/FR-009) — language id → the CodeMirror grammar that highlights it.
 *
 * This lives in the renderer, NOT in core: a grammar is a CodeMirror/DOM concern, and core stays
 * free of both (Principle II). Core owns WHAT a language is (the registry); this owns HOW it is
 * highlighted. That split is what lets a new language be a pure-data descriptor plus one line here.
 *
 * Every loader is a DYNAMIC import, and Vite gives each grammar its own chunk: a document only
 * ever downloads the one language it is in. Thirty-one grammars eagerly bundled would blow FR-008's
 * 200 ms first-highlight budget on their own.
 */
import { StreamLanguage, type LanguageSupport } from '@codemirror/language';

type Loader = () => Promise<LanguageSupport>;

/** A legacy CodeMirror 5 mode, wrapped as a CM6 language. */
const stream = (load: () => Promise<{ [k: string]: unknown }>, key: string): Loader =>
  async () => {
    const mod = await load();
    // StreamLanguage.define returns a Language; LanguageSupport wraps it with its extensions.
    const { LanguageSupport: Support } = await import('@codemirror/language');
    return new Support(StreamLanguage.define(mod[key] as Parameters<typeof StreamLanguage.define>[0]));
  };

/**
 * One entry per registry descriptor. The set of keys here MUST equal the set of registry ids —
 * `language-loaders.test.ts` asserts it, because a missing or mistyped entry does not throw: it
 * degrades SILENTLY to plain text, and every other test still passes.
 */
export const LANGUAGE_LOADERS: Readonly<Record<string, Loader>> = {
  // Lezer grammars (first-class CM6 packages).
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }),
  python: async () => (await import('@codemirror/lang-python')).python(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  // C has no grammar of its own; the C++ one is a strict superset and is what every editor uses.
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  php: async () => (await import('@codemirror/lang-php')).php(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  less: async () => (await import('@codemirror/lang-less')).less(),
  sass: async () => (await import('@codemirror/lang-sass')).sass(),
  vue: async () => (await import('@codemirror/lang-vue')).vue(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  // JSONC is JSON *with comments*, and CM's JSON grammar REJECTS them — every comment would light
  // up as an error. JavaScript parses the same text happily, comments included.
  jsonc: async () => (await import('@codemirror/lang-javascript')).javascript(),
  // A notebook on disk IS JSON, and that is what the editor is showing (FR-009).
  jupyter: async () => (await import('@codemirror/lang-json')).json(),

  // Legacy CodeMirror 5 modes, wrapped in StreamLanguage. No Lezer grammar exists for these; the
  // legacy mode is a real highlighter, not a stub.
  csharp: stream(() => import('@codemirror/legacy-modes/mode/clike'), 'csharp'),
  kotlin: stream(() => import('@codemirror/legacy-modes/mode/clike'), 'kotlin'),
  dart: stream(() => import('@codemirror/legacy-modes/mode/clike'), 'dart'),
  swift: stream(() => import('@codemirror/legacy-modes/mode/swift'), 'swift'),
  ruby: stream(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  lua: stream(() => import('@codemirror/legacy-modes/mode/lua'), 'lua'),
  powershell: stream(() => import('@codemirror/legacy-modes/mode/powershell'), 'powerShell'),
  shell: stream(() => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  toml: stream(() => import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  ini: stream(() => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
};

/**
 * Load the grammar for `languageId`, or null for plain text and anything the registry does not
 * know — a persisted override naming a language a later build removed must open the file, not
 * fail it (FR-005b).
 */
export async function loadLanguage(languageId: string): Promise<LanguageSupport | null> {
  const loader = LANGUAGE_LOADERS[languageId];
  if (!loader) return null;
  return loader();
}
