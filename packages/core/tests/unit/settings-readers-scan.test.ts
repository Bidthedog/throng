import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { scanSettingReaders } from './settings-readers-scan.js';
import { allowlistProblems, isProductionSource } from './inert-settings-policy.js';

/**
 * 071 — the settings readers scan, rule by rule, against small in-memory programs.
 *
 * `no-inert-settings.test.ts` runs the scan over the whole repository; this file proves each rule it relies on
 * in isolation (contract `specs/071-inert-settings-guard/contracts/settings-readers-scan.md`, fixture table), so a
 * green guard means "every setting is read" and not "the scan stopped seeing anything". Each fixture is a handful
 * of virtual files compiled against the real default library, which costs milliseconds, not the repository's 12 s.
 */

const ROOT = '/fx/';

/** The shared fixture settings shape: a nested section, a shared shape at two paths, a literal-keyed section, a map. */
const SETTINGS = `
export interface Pane { maxWidth: number; open: boolean }
export interface Row { toast: boolean; panel: boolean }
export interface Provider { enabled: boolean; gutter: boolean }
export interface Settings {
  a: { b: number; c: string; deep: { d: boolean } };
  panes: { left: Pane; right: Pane };
  n: { error: Row; warning: Row; info: Row };
  m: { providers: Record<string, Provider> };
  x: number;
}
export declare function useSettings(): Settings;
`;

const JSX_SHIM = `
declare namespace JSX {
  interface Element { readonly __el: true }
  interface IntrinsicElements { div: Record<string, unknown> }
  interface ElementChildrenAttribute { children: {} }
}
`;

interface Fixture {
  /** File name (relative to the fixture root) → source. `settings.ts` and a JSX shim are always added. */
  files: Record<string, string>;
  keys: readonly string[];
  configLayer?: readonly string[];
  /** Defaults to every file outside `tests/`. */
  isProduction?: (rel: string) => boolean;
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** A program over virtual files, falling back to the real file system only for the default library. */
function fixtureProgram(files: Record<string, string>): ts.Program {
  const all: Record<string, string> = { 'settings.ts': SETTINGS, 'jsx-shim.d.ts': JSX_SHIM, ...files };
  const virtual = new Map(Object.entries(all).map(([name, text]) => [ROOT + name, text]));
  const host = ts.createCompilerHost(OPTIONS);
  const realGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (f) => virtual.has(f) || ts.sys.fileExists(f);
  // Module resolution asks whether a directory exists before probing files in it; the virtual root exists only here.
  host.directoryExists = (d) => [...virtual.keys()].some((f) => f.startsWith(d.endsWith('/') ? d : `${d}/`)) || ts.sys.directoryExists(d);
  host.readFile = (f) => virtual.get(f) ?? ts.sys.readFile(f);
  host.getSourceFile = (f, lang, onError, create) => {
    const text = virtual.get(f);
    return text === undefined
      ? realGetSourceFile(f, lang, onError, create)
      : ts.createSourceFile(f, text, lang, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  };
  host.getCurrentDirectory = () => ROOT;
  return ts.createProgram({ rootNames: [...virtual.keys()], options: OPTIONS, host });
}

/** Scan a fixture; returns key → its reading files. */
function scan(fx: Fixture): Record<string, string[]> {
  const program = fixtureProgram(fx.files);
  // A fixture that does not compile (an unresolved import, a typo) resolves nothing, and every "unread"
  // expectation would then pass for the wrong reason. Each fixture must be valid TypeScript.
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  expect(diagnostics, 'the fixture itself must compile').toEqual([]);
  const report = scanSettingReaders({
    program,
    rootType: (checker, p) => {
      const sf = p.getSourceFile(ROOT + 'settings.ts');
      const sym = sf && checker.getSymbolAtLocation(sf)?.exports?.get(ts.escapeLeadingUnderscores('Settings'));
      if (!sym) throw new Error('fixture has no Settings interface');
      return checker.getDeclaredTypeOfSymbol(sym);
    },
    keys: fx.keys,
    relPath: (sf) => sf.fileName.slice(ROOT.length),
    isProduction: fx.isProduction ?? ((rel) => !rel.startsWith('tests/') && !rel.endsWith('.d.ts') && rel !== 'settings.ts'),
    configLayer: fx.configLayer ?? [],
  });
  return Object.fromEntries(report.map((r) => [r.key, r.readers]));
}

/** Absolute, so a fixture file in a subfolder (`config/`, `tests/`) resolves it the same way. */
const IMPORT = `import { useSettings, type Settings } from '${ROOT}settings';`;

describe('071 settings readers scan — direct reads (US1)', () => {
  it('counts a direct property access as a read of its key path', () => {
    const r = scan({
      keys: ['a.b', 'a.c'],
      files: { 'use.ts': `${IMPORT} export const v = useSettings().a.b;` },
    });
    expect(r).toEqual({ 'a.b': ['use.ts'], 'a.c': [] });
  });

  it('reports every unread key, not only the first, in input order', () => {
    const r = scan({ keys: ['x', 'a.c', 'a.b'], files: { 'use.ts': `${IMPORT} export const v = useSettings().a.b;` } });
    expect(Object.entries(r)).toEqual([
      ['x', []],
      ['a.c', []],
      ['a.b', ['use.ts']],
    ]);
  });

  it('lists each reading file once, sorted', () => {
    const read = `${IMPORT} export const v = useSettings().a.b + useSettings().a.b;`;
    const r = scan({ keys: ['a.b'], files: { 'z.ts': read, 'b.ts': read } });
    expect(r['a.b']).toEqual(['b.ts', 'z.ts']);
  });

  it('counts a read beneath a key as a read of that key', () => {
    const r = scan({ keys: ['a.deep'], files: { 'use.ts': `${IMPORT} export const v = useSettings().a.deep.d;` } });
    expect(r['a.deep']).toEqual(['use.ts']);
  });

  it('does not count a key mentioned only in a configuration-layer file', () => {
    const r = scan({
      keys: ['a.b'],
      configLayer: ['config/'],
      files: { 'config/defaults.ts': `${IMPORT} export const v = useSettings().a.b;` },
    });
    expect(r['a.b']).toEqual([]);
  });

  it('does not count a key read only in a test file (FR-008)', () => {
    const r = scan({ keys: ['a.b'], files: { 'tests/a.test.ts': `${IMPORT} export const v = useSettings().a.b;` } });
    expect(r['a.b']).toEqual([]);
  });

  it('does not count an assignment as a read', () => {
    const r = scan({ keys: ['a.b'], files: { 'use.ts': `${IMPORT} export function f(s: Settings) { s.a.b = 1; }` } });
    expect(r['a.b']).toEqual([]);
  });
});

describe('071 settings readers scan — a reader removed (US2, SC-003)', () => {
  const reader = `${IMPORT} export const v = useSettings().a.b;`;

  it('reports a key unread once its only reader is gone', () => {
    expect(scan({ keys: ['a.b'], files: { 'one.ts': reader } })['a.b']).toEqual(['one.ts']);
    expect(scan({ keys: ['a.b'], files: {} })['a.b']).toEqual([]);
  });

  it('still counts a key read when one of its two readers is gone', () => {
    expect(scan({ keys: ['a.b'], files: { 'one.ts': reader, 'two.ts': reader } })['a.b']).toEqual(['one.ts', 'two.ts']);
    expect(scan({ keys: ['a.b'], files: { 'two.ts': reader } })['a.b']).toEqual(['two.ts']);
  });
});

describe('071 settings readers scan — the ways settings are really read (US3)', () => {
  it('follows an aliased section object (the case that defeated 019’s text scan)', () => {
    const r = scan({
      keys: ['a.b', 'a.c'],
      files: { 'use.ts': `${IMPORT} const section = useSettings().a; export const v = section.b;` },
    });
    expect(r).toEqual({ 'a.b': ['use.ts'], 'a.c': [] });
  });

  it('follows destructuring, nested patterns included', () => {
    const r = scan({
      keys: ['a.b', 'a.c', 'a.deep.d'],
      files: { 'use.ts': `${IMPORT} const { b, deep: { d } } = useSettings().a; export const v = [b, d];` },
    });
    expect(r).toEqual({ 'a.b': ['use.ts'], 'a.c': [], 'a.deep.d': ['use.ts'] });
  });

  it('follows a section into a function whose parameter has a separately declared mirror type', () => {
    const r = scan({
      keys: ['a.b', 'a.c'],
      files: {
        'plan.ts': `export interface Mirror { b: number; c: string } export function plan(m: Mirror) { return m.b; }`,
        'use.ts': `${IMPORT} import { plan } from './plan'; export const v = plan(useSettings().a);`,
      },
    });
    expect(r).toEqual({ 'a.b': ['plan.ts'], 'a.c': [] });
  });

  it('follows a section passed as a JSX prop and destructured in the component', () => {
    const r = scan({
      keys: ['a.b', 'a.c'],
      files: {
        'view.tsx': `export function View({ sec }: { sec: { b: number; c: string } }): JSX.Element { return <div n={sec.b} />; }`,
        'app.tsx': `${IMPORT} import { View } from './view'; export const el = <View sec={useSettings().a} />;`,
      },
    });
    expect(r).toEqual({ 'a.b': ['view.tsx'], 'a.c': [] });
  });

  it('follows a section into a Pick<> parameter', () => {
    const r = scan({
      keys: ['a.b', 'a.c'],
      files: {
        'pick.ts': `import type { Settings } from './settings'; export const f = (p: Pick<Settings['a'], 'b'>) => p.b;`,
        'use.ts': `${IMPORT} import { f } from './pick'; export const v = f(useSettings().a);`,
      },
    });
    expect(r).toEqual({ 'a.b': ['pick.ts'], 'a.c': [] });
  });

  it('counts a computed index for each member of its literal-union key type, and no other', () => {
    const r = scan({
      keys: ['n.error.toast', 'n.warning.toast', 'n.info.toast', 'n.error.panel'],
      files: {
        'use.ts': `${IMPORT} export function f(sev: 'error' | 'warning') { return useSettings().n[sev].toast; }`,
      },
    });
    expect(r).toEqual({ 'n.error.toast': ['use.ts'], 'n.warning.toast': ['use.ts'], 'n.info.toast': [], 'n.error.panel': [] });
  });

  it('matches a read through a Record map against every concrete descriptor beneath it', () => {
    const r = scan({
      keys: ['m.providers.markdown.gutter', 'm.providers.mermaid.gutter', 'm.providers.markdown.enabled'],
      files: { 'use.ts': `${IMPORT} export function f(id: string) { return useSettings().m.providers[id]?.gutter; }` },
    });
    expect(r).toEqual({
      'm.providers.markdown.gutter': ['use.ts'],
      'm.providers.mermaid.gutter': ['use.ts'],
      'm.providers.markdown.enabled': [],
    });
  });

  it('reads a map by a literal key as that entry only', () => {
    const r = scan({
      keys: ['m.providers.markdown.gutter', 'm.providers.mermaid.gutter'],
      files: { 'use.ts': `${IMPORT} export const g = useSettings().m.providers['markdown']?.gutter;` },
    });
    expect(r).toEqual({ 'm.providers.markdown.gutter': ['use.ts'], 'm.providers.mermaid.gutter': [] });
  });

  it('follows an alias of one shared-shape section without spilling onto its twin', () => {
    const r = scan({
      keys: ['panes.left.maxWidth', 'panes.right.maxWidth'],
      files: { 'use.ts': `${IMPORT} const pane = useSettings().panes.right; export const w = pane.maxWidth;` },
    });
    expect(r).toEqual({ 'panes.left.maxWidth': [], 'panes.right.maxWidth': ['use.ts'] });
  });

  it('attributes a read to its own path, not to another key of the same shape (FR-006)', () => {
    const r = scan({
      keys: ['panes.left.maxWidth', 'panes.right.maxWidth'],
      files: { 'use.ts': `${IMPORT} export const w = useSettings().panes.left.maxWidth;` },
    });
    expect(r).toEqual({ 'panes.left.maxWidth': ['use.ts'], 'panes.right.maxWidth': [] });
  });

  it('counts a shared-shape parameter for every path its calls supply', () => {
    const r = scan({
      keys: ['panes.left.maxWidth', 'panes.right.maxWidth', 'panes.left.open'],
      files: {
        'width.ts': `import type { Pane } from './settings'; export const width = (p: Pane) => p.maxWidth;`,
        'use.ts': `${IMPORT} import { width } from './width'; export const w = width(useSettings().panes.right);`,
      },
    });
    expect(r).toEqual({ 'panes.left.maxWidth': [], 'panes.right.maxWidth': ['width.ts'], 'panes.left.open': [] });
  });

  it('never resolves a primitive by its type alone', () => {
    const r = scan({
      keys: ['x', 'a.b'],
      files: {
        'num.ts': `export const double = (n: number) => n * 2; export const toFixed = (n: number) => n.toFixed(1);`,
        'use.ts': `import { double, toFixed } from './num'; export const v = toFixed(double(3));`,
      },
    });
    expect(r).toEqual({ x: [], 'a.b': [] });
  });

  it('does not let a configuration-layer call site bind a parameter', () => {
    const r = scan({
      keys: ['a.b'],
      configLayer: ['config/'],
      files: {
        'plan.ts': `export interface Mirror { b: number } export function plan(m: Mirror) { return m.b; }`,
        'config/validate.ts': `${IMPORT} import { plan } from '../plan'; export const v = plan(useSettings().a);`,
      },
    });
    expect(r['a.b']).toEqual([]);
  });
});

describe('071 which repository files may hold a reader (FR-008)', () => {
  it.each([
    ['packages/ui/src/renderer/explorer/file-tree.tsx', true],
    ['packages/core/src/workspace/destroy.ts', true],
    ['packages/core/src/testing/config-store-contract.ts', false],
    ['packages/ui/src/renderer/global.d.ts', false],
    ['packages/core/tests/unit/settings-metadata.test.ts', false],
    ['scripts/gate.mjs', false],
  ])('%s → %s', (rel, expected) => {
    expect(isProductionSource(rel)).toBe(expected);
  });
});

describe('071 allowlist validation (US4, FR-011)', () => {
  const report = [
    { key: 'a.b', readers: [] },
    { key: 'a.c', readers: ['use.ts'] },
  ];
  const reason = 'Read only by the parser, which applies it before any consumer sees the document.';

  it('accepts a current, unread entry with a real reason', () => {
    expect(allowlistProblems([{ key: 'a.b', reason }], report)).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['TODO', 'TODO'],
    ['TBD', 'tbd'],
    ['a dash', '-'],
    ['n/a', 'N/A'],
    ['under 20 characters', 'not used anywhere'],
  ])('rejects a %s reason, naming the key', (_label, bad) => {
    const problems = allowlistProblems([{ key: 'a.b', reason: bad }], report);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('a.b');
  });

  it('rejects a stale entry whose key now has a reader', () => {
    const problems = allowlistProblems([{ key: 'a.c', reason }], report);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('a.c');
    expect(problems[0]).toContain('use.ts');
  });

  it('rejects an entry whose key is no longer a descriptor', () => {
    const problems = allowlistProblems([{ key: 'gone.key', reason }], report);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('gone.key');
  });
});
