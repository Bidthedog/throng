/**
 * 044 T160 — no shared surface names a preview provider (FR-070, SC-003;
 * contracts/preview-provider-seam.md §3 and §6).
 *
 * ══ WHAT THIS HOLDS THE CODEBASE TO ══
 *
 * Adding a provider is a descriptor, a view and one line in each registration index. That stays true
 * only while nothing outside a provider's own folders knows a provider exists — so this guard reads the
 * source and fails on the two ways a surface comes to know one:
 *
 * 1. **An import from `preview/providers/`** other than the two registration indexes. A surface that
 *    imports the Markdown view or descriptor is special-cased to it, whatever it does with it. No
 *    exception is possible here, so there is no allowlist for this rule.
 * 2. **A Markdown-specific token** outside comments: the exact literals `'markdown'` and `'.md'` the
 *    contract names, and — because a guard shaped like those two literals would watch
 *    `if (id === MARKDOWN_ID)` or `import { markdownView }` sail past — ANY identifier, string or
 *    template text, JSX text or CSS token containing `markdown`, or naming the `md` extension. A
 *    regex literal is tested by its PATTERN BODY (delimiters, flags and its own `^`/`$` anchors
 *    stripped), so `/\.md$/` is caught the same as the string `'.md'` would be.
 *
 * ══ THE SCOPE IS DISCOVERED, NOT LISTED ══
 *
 * Two scopes, both walked from disk:
 *
 * - **The contract scope** (§3, below its table): every file under the renderer's `preview/`,
 *   `state/`, `workspace/`, `editor/`, `explorer/` and `preferences/`, the four named main files and
 *   core's `config/app-settings.ts`. The guard asserts it is non-empty and still holds
 *   `state/workspace-store.tsx` and `main/preview-service.ts`, so a moved directory cannot make it
 *   vacuous.
 * - **The discovery scope**: EVERY source and stylesheet under `packages/ui/src` and
 *   `packages/core/src`. The contract scope is where FR-070's surfaces are known to live; a surface
 *   added somewhere else tomorrow is not, and a guard that only read the files someone remembered is
 *   the failure this task exists to prevent.
 *
 * Both exclude only the provider folders themselves — `packages/core/src/preview/providers/**` and
 * `packages/ui/src/renderer/preview/providers/**`, which is where the two registration indexes live.
 *
 * ══ WHY A PARSER, NOT A REGULAR EXPRESSION ══
 *
 * "Outside comments" is the whole difficulty. The existing surfaces mention `.md` constantly — in
 * comments naming spec files (`contracts/preview-ipc.md`) — and a regex that strips `//` and `/* *\/`
 * is fooled by the first string or regex literal containing either. The TypeScript scanner already
 * knows what a comment is, so the TS and TSX files are read as syntax trees and only real tokens are
 * inspected. Stylesheets have one comment form and no strings that can hide one, so those are stripped
 * textually.
 *
 * ══ THE ALLOWLIST ══
 *
 * Markdown is also an EDITOR LANGUAGE (`core/src/editor/languages.ts`) and a FILE ICON, and both of
 * those legitimately say its name. Each allowed token is listed per file with the reason it is not a
 * provider reference — "a new provider needs no edit here" is the test every reason must pass. An
 * entry that no longer matches anything fails the build too, so the list cannot rot into a blanket
 * pass.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const UI_SRC = 'packages/ui/src';
const CORE_SRC = 'packages/core/src';

/** The provider folders. Everything under them is a provider's own code, and exempt. */
const PROVIDER_FOLDERS = [`${CORE_SRC}/preview/providers/`, `${UI_SRC}/renderer/preview/providers/`];

/** The two registration indexes — the only files outside a provider that may import one. */
const REGISTRATION_INDEXES = [`${CORE_SRC}/preview/providers/index.ts`, `${UI_SRC}/renderer/preview/providers/index.ts`];

/** contracts/preview-provider-seam.md §3 — the directories, then the named files. */
const CONTRACT_DIRECTORIES = ['preview', 'state', 'workspace', 'editor', 'explorer', 'preferences'].map(
  (d) => `${UI_SRC}/renderer/${d}/`,
);
const CONTRACT_FILES = [
  `${UI_SRC}/main/preview-service.ts`,
  `${UI_SRC}/main/renderer-request-filter.ts`,
  `${UI_SRC}/main/preview-protocol.ts`,
  `${UI_SRC}/main/preview-purge.ts`,
  `${CORE_SRC}/config/app-settings.ts`,
];

const SOURCE = /\.(?:[cm]?tsx?|css)$/;

const toRepoPath = (abs: string): string => relative(REPO, abs).split(sep).join('/');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (SOURCE.test(entry)) out.push(toRepoPath(path));
  }
  return out;
}

const inProviderFolder = (file: string): boolean => PROVIDER_FOLDERS.some((folder) => file.startsWith(folder));

/** Every source and stylesheet under the two trees, provider folders excluded. */
const DISCOVERY_SCOPE: readonly string[] = [UI_SRC, CORE_SRC]
  .flatMap((root) => walk(join(REPO, root)))
  .filter((file) => !inProviderFolder(file))
  .sort();

const inContractScope = (file: string): boolean =>
  CONTRACT_FILES.includes(file) || CONTRACT_DIRECTORIES.some((dir) => file.startsWith(dir));

const CONTRACT_SCOPE: readonly string[] = DISCOVERY_SCOPE.filter(inContractScope);

/* ── The scanner ───────────────────────────────────────────────────────────────────────────── */

type HitKind = 'identifier' | 'literal' | 'jsx-text' | 'css';

interface Hit {
  file: string;
  line: number;
  kind: HitKind;
  /** The identifier's name, the literal's value, or the CSS word — what the allowlist matches. */
  token: string;
}

interface ImportHit {
  file: string;
  line: number;
  specifier: string;
}

/** Contains `markdown`, in any case. */
const MARKDOWN = /markdown/i;
/** A literal naming the `md` extension: `'.md'`, `'md'`, or a file name ending in it. */
const MD_LITERAL = /(?:^|\.)md$/i;
/** An identifier naming the `md` extension on its own. */
const MD_IDENTIFIER = /^md$/i;

/**
 * A `RegularExpressionLiteral`'s `.text` is its raw SOURCE — delimiters and flags included, e.g.
 * `"/\.md$/i"` for the pattern `/\.md$/i`. Tested as-is against `MARKDOWN`/`MD_LITERAL`, `/\.md$/`
 * never matches: the trailing `/` and `$` sit where those patterns expect the extension to end. So
 * strip the delimiters and flags first, then unescape the pattern's own backslash-escapes and drop
 * its `^`/`$` anchors — regex syntax, not text — leaving the plain text the pattern targets (`.md`),
 * which is what MARKDOWN and MD_LITERAL are written to recognise.
 */
function regexBodyOf(text: string): string {
  const body = /^\/(.*)\/[a-zA-Z]*$/.exec(text)?.[1] ?? text;
  return body.replace(/\\(.)/g, '$1').replace(/^\^/, '').replace(/\$$/, '');
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function scriptKindOf(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Whether a module specifier, written in `file`, lands inside a provider folder other than its index. */
function importsAProvider(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return /(?:^|\/)preview\/providers\/(?!index(?:\.[cm]?[jt]sx?)?$)/.test(specifier);
  const target = toRepoPath(resolve(REPO, dirname(file), specifier));
  if (!inProviderFolder(`${target}/`) && !inProviderFolder(target)) return false;
  const withoutExtension = target.replace(/\.[cm]?[jt]sx?$/, '');
  return !REGISTRATION_INDEXES.some((index) => index.replace(/\.ts$/, '') === withoutExtension);
}

/** Scan one TS/TSX source. Exported shape kept local; the self-test below drives it on samples. */
function scanScript(file: string, text: string): { hits: Hit[]; imports: ImportHit[] } {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const hits: Hit[] = [];
  const imports: ImportHit[] = [];

  /** `value` is what gets tested against MARKDOWN/MD_LITERAL; `token` (default: `value`) is what a
   *  failure reports — for a regex literal these differ, since the test value is the pattern body
   *  but the report should show the whole `/pattern/flags` so a human can find it in the source. */
  const literal = (node: ts.Node, value: string, token: string = value): void => {
    if (MARKDOWN.test(value) || MD_LITERAL.test(value)) {
      hits.push({ file, line: lineOf(sourceFile, node), kind: 'literal', token });
    }
  };
  const specifierOf = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node) && importsAProvider(file, node.text)) {
      imports.push({ file, line: lineOf(sourceFile, node), specifier: node.text });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifierOf(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifierOf(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifierOf(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifierOf(node.argument.literal);
    }

    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const name = node.text;
      if (MARKDOWN.test(name) || MD_IDENTIFIER.test(name)) {
        hits.push({ file, line: lineOf(sourceFile, node), kind: 'identifier', token: name });
      }
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literal(node, node.text);
    } else if (ts.isRegularExpressionLiteral(node)) {
      literal(node, regexBodyOf(node.text), node.text);
    } else if (ts.isJsxText(node) && MARKDOWN.test(node.text)) {
      hits.push({ file, line: lineOf(sourceFile, node), kind: 'jsx-text', token: node.text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { hits, imports };
}

/** Scan one stylesheet: comments removed (keeping line breaks, so lines still count), then every word. */
function scanStylesheet(file: string, text: string): Hit[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const hits: Hit[] = [];
  code.split('\n').forEach((lineText, i) => {
    for (const match of lineText.matchAll(/[\w-]*markdown[\w-]*/gi)) {
      hits.push({ file, line: i + 1, kind: 'css', token: match[0] });
    }
  });
  return hits;
}

function scan(file: string, text: string): { hits: Hit[]; imports: ImportHit[] } {
  return file.endsWith('.css') ? { hits: scanStylesheet(file, text), imports: [] } : scanScript(file, text);
}

/* ── The allowlist ─────────────────────────────────────────────────────────────────────────── */

interface Allowed {
  file: string;
  kind: HitKind;
  token: string;
  reason: string;
}

const EDITOR_LANGUAGE =
  'Markdown the EDITOR LANGUAGE (core/src/editor/languages.ts), not the preview provider: a new provider needs no edit here';
const FILE_ICON = 'the Files & Folders file-type ICON for .md files, keyed by extension: unrelated to previews';

const ALLOWED: readonly Allowed[] = [
  /* The editor language registry and its grammar loader. */
  { file: `${CORE_SRC}/editor/languages.ts`, kind: 'literal', token: 'markdown', reason: `${EDITOR_LANGUAGE} — its language id` },
  { file: `${CORE_SRC}/editor/languages.ts`, kind: 'literal', token: 'Markdown', reason: `${EDITOR_LANGUAGE} — its language name` },
  { file: `${CORE_SRC}/editor/languages.ts`, kind: 'literal', token: '.md', reason: `${EDITOR_LANGUAGE} — the extensions it is detected by` },
  { file: `${CORE_SRC}/editor/languages.ts`, kind: 'literal', token: '.markdown', reason: `${EDITOR_LANGUAGE} — the extensions it is detected by` },
  { file: `${UI_SRC}/renderer/editor/language-loaders.ts`, kind: 'identifier', token: 'markdown', reason: `${EDITOR_LANGUAGE} — the CodeMirror grammar keyed by language id` },
  { file: `${UI_SRC}/renderer/editor/language-loaders.ts`, kind: 'literal', token: '@codemirror/lang-markdown', reason: `${EDITOR_LANGUAGE} — the grammar package` },

  /*
   * FR-090d: a link followed from a preview to `other.md#heading` opens an EDITOR at the heading. What a
   * heading is depends on the target file's editor language, so the editor asks `detectLanguage`, and
   * only Markdown has headings it can find. A new preview provider changes nothing here; a new editor
   * language with headings would, and that is the language registry's business.
   *
   * `markdownHeadingLine` itself moved into the Markdown provider's own folder (fix round 1, item 3),
   * so it is no longer a hit in `preview/links.ts` — only its two remaining mentions need allowing:
   * the editor reveal that calls it, and the core barrel forwarding it from the registration index.
   */
  { file: `${UI_SRC}/renderer/editor/reveal-range.ts`, kind: 'literal', token: 'markdown', reason: `${EDITOR_LANGUAGE} — compared against detectLanguage() for the FR-090d heading reveal` },
  { file: `${UI_SRC}/renderer/editor/reveal-range.ts`, kind: 'identifier', token: 'markdownHeadingLine', reason: `${EDITOR_LANGUAGE} — the heading grammar the FR-090d editor reveal resolves against` },
  { file: `${CORE_SRC}/index.ts`, kind: 'identifier', token: 'markdownHeadingLine', reason: 'the barrel re-export of the heading grammar, forwarded through the registration index' },

  /* The file-type icon, in the theme, its editor copy, the tree and the icon-pack generator. */
  { file: `${CORE_SRC}/config/theme.ts`, kind: 'identifier', token: 'fileMarkdown', reason: `${FILE_ICON} — the theme token` },
  { file: `${CORE_SRC}/config/theme-copy.ts`, kind: 'literal', token: 'icons.fileMarkdown', reason: `${FILE_ICON} — the token's editor copy` },
  { file: `${CORE_SRC}/config/theme-copy.ts`, kind: 'literal', token: 'Markdown file icon', reason: `${FILE_ICON} — the token's editor copy` },
  { file: `${CORE_SRC}/config/theme-copy.ts`, kind: 'literal', token: 'The glyph shown beside a Markdown document in the tree.', reason: `${FILE_ICON} — the token's editor copy` },
  {
    file: `${CORE_SRC}/config/theme-copy.ts`,
    kind: 'literal',
    token:
      'The glyph on the editor status bar button and menu rows that open a rendered, read-only view of a file such as a Markdown document, and at the head of that preview panel’s title.',
    reason: 'user-facing copy for the `preview` icon token naming Markdown as an EXAMPLE of a previewable file; it selects nothing',
  },
  { file: `${UI_SRC}/renderer/explorer/tree-icons.ts`, kind: 'identifier', token: 'md', reason: `${FILE_ICON} — the extension key` },
  { file: `${UI_SRC}/renderer/explorer/tree-icons.ts`, kind: 'identifier', token: 'markdown', reason: `${FILE_ICON} — the extension key` },
  { file: `${UI_SRC}/renderer/explorer/tree-icons.ts`, kind: 'literal', token: 'fileMarkdown', reason: `${FILE_ICON} — the icon it maps to` },
  { file: `${UI_SRC}/main/icon-pack-service.ts`, kind: 'identifier', token: 'fileMarkdown', reason: `${FILE_ICON} — the shipped SVG for the token` },
  { file: `${UI_SRC}/main/icon-pack-service.ts`, kind: 'literal', token: 'README.md', reason: 'the icon-pack folder’s own README file name: unrelated to previews' },

  /*
   * Fix round 1, item 2 — the Markdown body's styles moved into the provider's own folder
   * (`providers/markdown/markdown.css`), which the discovery scope excludes entirely, so no allowance
   * for `preview-markdown*` is needed any more. `preview/preview.css` now holds only panel chrome
   * (`.preview-panel`, `.preview-panel__body`), which names no provider.
   */
];

const isAllowed = (hit: Hit): boolean =>
  ALLOWED.some((a) => a.file === hit.file && a.kind === hit.kind && a.token === hit.token);

/* ── The scan, once ────────────────────────────────────────────────────────────────────────── */

const SCANNED = DISCOVERY_SCOPE.map((file) => scan(file, readFileSync(join(REPO, file), 'utf8')));
const HITS: readonly Hit[] = SCANNED.flatMap((s) => s.hits);
const IMPORTS: readonly ImportHit[] = SCANNED.flatMap((s) => s.imports);

const describeHit = (h: Hit): string => `${h.file}:${h.line} ${h.kind} ${JSON.stringify(h.token)}`;

/* ── The tests ─────────────────────────────────────────────────────────────────────────────── */

describe('the guard’s scope cannot go vacuous (contracts/preview-provider-seam.md §6)', () => {
  it('discovers a non-empty contract scope that still holds workspace-store.tsx and preview-service.ts', () => {
    expect(CONTRACT_SCOPE.length).toBeGreaterThan(50);
    expect(CONTRACT_SCOPE).toContain(`${UI_SRC}/renderer/state/workspace-store.tsx`);
    expect(CONTRACT_SCOPE).toContain(`${UI_SRC}/main/preview-service.ts`);
  });

  it('finds every named contract file on disk, and a directory scope for each named directory', () => {
    for (const file of CONTRACT_FILES) expect(CONTRACT_SCOPE, file).toContain(file);
    for (const dir of CONTRACT_DIRECTORIES) {
      expect(CONTRACT_SCOPE.some((file) => file.startsWith(dir)), `nothing found under ${dir}`).toBe(true);
    }
  });

  it('reads beyond the contract scope — all of packages/ui/src and packages/core/src — and excludes only the provider folders', () => {
    expect(DISCOVERY_SCOPE.length).toBeGreaterThan(CONTRACT_SCOPE.length);
    expect(DISCOVERY_SCOPE).toContain(`${UI_SRC}/main/main.ts`);
    expect(DISCOVERY_SCOPE).toContain(`${CORE_SRC}/config/settings-metadata.ts`);
    expect(DISCOVERY_SCOPE.filter(inProviderFolder)).toEqual([]);
    // The exclusion is real: the provider folders exist and hold what the scope leaves out.
    expect(walk(join(REPO, PROVIDER_FOLDERS[1])).length).toBeGreaterThan(1);
    for (const index of REGISTRATION_INDEXES) expect(statSync(join(REPO, index)).isFile(), index).toBe(true);
  });
});

describe('the scanner sees what it claims to, and nothing in a comment (anti-vacuity)', () => {
  const sample = (text: string, file = `${UI_SRC}/renderer/editor/sample.tsx`) => scan(file, text);

  it('flags the contract’s exact literals in either quote style, and in a template', () => {
    const { hits } = sample("const a = 'markdown'; const b = \".md\"; const c = `markdown`;");
    expect(hits.map((h) => h.token)).toEqual(['markdown', '.md', 'markdown']);
  });

  it('flags a regex literal whose pattern body names Markdown or the .md extension, but not an unrelated regex', () => {
    const { hits } = sample('const a = /\\.md$/; const b = /\\.MD$/i; const c = /markdown/i; const d = /unrelated/;');
    expect(hits.map((h) => `${h.kind}:${h.token}`)).toEqual([
      'literal:/\\.md$/',
      'literal:/\\.MD$/i',
      'literal:/markdown/i',
    ]);
  });

  it('flags a Markdown identifier, JSX text and a file name ending .md', () => {
    const { hits } = sample("import { markdownView } from 'x'; const n = 'README.md'; const el = <p>Markdown</p>;");
    expect(hits.map((h) => `${h.kind}:${h.token}`)).toEqual(['identifier:markdownView', 'literal:README.md', 'jsx-text:Markdown']);
  });

  it('ignores both comment forms, including one naming a spec file', () => {
    const { hits } = sample("// see contracts/preview-ipc.md for 'markdown'\n/* markdown '.md' */\nconst x = 1;");
    expect(hits).toEqual([]);
  });

  it('flags an import of a provider module, relative or not, but not of a registration index', () => {
    const file = `${UI_SRC}/renderer/preview/sample.tsx`;
    const { imports } = scan(
      file,
      [
        "import { markdownView } from './providers/markdown/view.js';",
        "import { PREVIEW_PROVIDER_VIEWS } from './providers/index.js';",
        "const lazy = () => import('../preview/providers/markdown/markdown-body.js');",
        "export { markdownProvider } from '@throng/core/src/preview/providers/markdown.js';",
      ].join('\n'),
    );
    expect(imports.map((i) => i.specifier)).toEqual([
      './providers/markdown/view.js',
      '../preview/providers/markdown/markdown-body.js',
      '@throng/core/src/preview/providers/markdown.js',
    ]);
  });

  it('reads a stylesheet’s selectors but not its comments', () => {
    const hits = scan(`${UI_SRC}/renderer/preview/sample.css`, '/* .preview-markdown */\n.preview-markdown h1 { color: red; }');
    expect(hits.hits.map((h) => `${h.line}:${h.token}`)).toEqual(['2:preview-markdown']);
  });
});

describe('no surface imports a provider (FR-070)', () => {
  it('imports from preview/providers/ only through the two registration indexes', () => {
    expect(
      IMPORTS.map((i) => `${i.file}:${i.line} imports ${i.specifier}`),
      'a surface imports a provider module — read it from PreviewProviderRegistryContext or an injected registry',
    ).toEqual([]);
  });
});

describe('no surface names a provider (FR-070)', () => {
  it('holds no exact \'markdown\' or \'.md\' literal outside comments in the contract scope, except as allowed', () => {
    const exact = HITS.filter(
      (h) => inContractScope(h.file) && h.kind === 'literal' && (h.token === 'markdown' || h.token === '.md'),
    );
    expect(exact.filter((h) => !isAllowed(h)).map(describeHit)).toEqual([]);
  });

  it('holds no Markdown-specific token anywhere in packages/ui/src or packages/core/src outside a provider folder, except as allowed', () => {
    expect(
      HITS.filter((h) => !isAllowed(h)).map(describeHit),
      'a shared surface names Markdown — derive it from the registry, or (only if it is not a provider reference) allow it with a reason',
    ).toEqual([]);
  });

  it('allows nothing that is no longer there, and gives every allowance a reason', () => {
    const stale = ALLOWED.filter((a) => !HITS.some((h) => h.file === a.file && h.kind === a.kind && h.token === a.token));
    expect(stale.map((a) => `${a.file} ${a.kind} ${JSON.stringify(a.token)}`)).toEqual([]);
    for (const a of ALLOWED) expect(a.reason.length, `${a.file} ${a.token}`).toBeGreaterThan(20);
  });
});
