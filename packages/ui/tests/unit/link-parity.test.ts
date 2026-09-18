import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  normaliseForCompare,
  previewSettingsDefaults,
  type IFileSystem,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import { WindowsPathForms } from '@throng/platform-windows';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import type { HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import { linkHitsBetween, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';
import { followLink, linkRouting, type LinkFollowDeps, type LinkRoutingInputs } from '../../src/renderer/links/link-actions.js';

/**
 * 045 T163 — SC-012 / FR-104 / FR-106: parity is STRUCTURAL, not promised.
 *
 * Every line of `tests/fixtures/links/parity.txt` (T134: one line per link kind × path form ×
 * position form in FR-100 / FR-003 / FR-004) goes through BOTH panel types' span producers — the
 * terminal's xterm link provider over a fake one-row buffer, and the editor's per-line function
 * `linkHitsBetween` over an `EditorState` (no view needed, so this stays a unit test) — and the two
 * must yield identical spans, kinds, resolved targets and click outcomes.
 *
 * Resolution is REAL: `FileLinkResolver` with core's rules and the Windows path forms, over a fake
 * disk holding the fixture tree at `D:\p` and one file outside it. So "the same target" is main's
 * answer, not the test's opinion.
 *
 * What the user sees today (O11's matrix probe): a plain-text URL is a link in every terminal and
 * NOT a link in the editor; the editor has no URL scan at all (contract §6.1), so the two panel types
 * disagree on every line that carries one.
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/links/parity.txt', import.meta.url));
const ROOT = 'D:\\p';

/** The fixture tree, as the fake disk holds it: every file and folder under `D:\p`, plus one outside. */
const DISK = new Map<string, 'file' | 'folder'>(
  [
    ['D:\\p', 'folder'],
    ['D:\\p\\src', 'folder'],
    ['D:\\p\\docs', 'folder'],
    ['D:\\p\\src\\foo.ts', 'file'],
    ['D:\\p\\docs\\a.md', 'file'],
    ['D:\\p\\docs\\b.md', 'file'],
    ['D:\\p\\docs\\My File.md', 'file'],
    ['D:\\p\\README.md', 'file'],
    ['D:\\p\\build.bat', 'file'],
    ['D:\\p\\deploy.ps1', 'file'],
    ['D:\\p\\test.txt', 'file'],
    ['C:\\elsewhere', 'folder'],
    ['C:\\elsewhere\\x.ts', 'file'],
  ].map(([p, k]) => [normaliseForCompare(p!), k as 'file' | 'folder']),
);

/**
 * Home is drive D's root, so `~/p/…` names the project (FR-106's "when the project is under the home
 * folder"). Spelled `D:` rather than `D:\` because `fromHomeForm` appends its own separator, and a
 * real home folder is never a drive root — a doubled separator here would be a harness artifact, not
 * anything a user can meet.
 */
class ParityPathForms extends WindowsPathForms {
  override homeDirectory(): string {
    return 'D:';
  }
}

const resolver = new FileLinkResolver({
  fs: {
    stat: async (p: string) => {
      // Windows' own `stat` tolerates a doubled separator (`D:\\p`), which `fromHomeForm` produces
      // for a home at a drive root; the fake disk tolerates it too. No UNC path is on this disk.
      const kind = DISK.get(normaliseForCompare(p.replace(/[\\/]+/g, '\\')));
      if (kind === undefined) throw new Error('ENOENT');
      return { kind, isSymlink: false };
    },
  } as unknown as IFileSystem,
  pathForms: new ParityPathForms(),
  executables: { isExecutable: (p: string) => /\.(exe|bat|cmd|ps1|lnk)$/i.test(p) },
  projectRootFor: () => ROOT,
  previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
  readPreviewSettings: () => previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
} as unknown as FileLinkResolverDeps);

const SITE = { panelId: 'panel-1', originProjectId: 'proj-1', baseDirectory: ROOT };

/** Main's answers, filled in two phases: ask (record), resolve (await), ask again (answer). */
const answers = new Map<string, LinkResolution>();
const pending = new Map<string, LinkResolutionRequest>();
const keyOf = (r: LinkResolutionRequest): string => JSON.stringify([r.kind, r.text, r.baseDirectory ?? '']);

function ask(request: LinkResolutionRequest): LinkResolution | undefined {
  const known = answers.get(keyOf(request));
  if (known === undefined) pending.set(keyOf(request), request);
  return known;
}

async function resolvePending(): Promise<void> {
  for (const [key, request] of [...pending]) {
    answers.set(key, await resolver.resolve(request));
    pending.delete(key);
  }
}

interface Span {
  readonly kind: 'web' | 'file';
  readonly start: number;
  readonly end: number;
  readonly target: string | undefined;
  readonly position?: LinkPosition;
}

/* ── The terminal's producer ───────────────────────────────────────────────────────────────── */

function terminalLinks(line: string): { links: ProvidedLink[]; hovered: HoveredLink[]; followed: unknown[] } {
  const hovered: HoveredLink[] = [];
  const followed: unknown[] = [];
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: (i: number) => (i === 0 ? { translateToString: () => line } : undefined) } } },
    site: () => SITE,
    ask,
    onHover: (h) => {
      if (h) hovered.push(h);
    },
    follow: (args) => void followed.push(args),
  });
  let links: ProvidedLink[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  return { links, hovered, followed };
}

function terminalSpans(line: string): Span[] {
  const { links, hovered, followed } = terminalLinks(line);
  return links.map((l) => {
    hovered.length = 0;
    followed.length = 0;
    l.hover({} as MouseEvent, l.text);
    l.activate({ ctrlKey: true, metaKey: false } as MouseEvent, l.text);
    const h = hovered[0];
    const f = followed[0] as { position?: LinkPosition } | undefined;
    return {
      kind: h?.kind ?? 'file',
      start: l.range.start.x - 1,
      end: l.range.end.x,
      target: h === undefined ? undefined : h.kind === 'web' ? h.uri : h.link.path,
      ...(f?.position === undefined ? {} : { position: f.position }),
    };
  });
}

/* ── The editor's producer ─────────────────────────────────────────────────────────────────── */

const editorDeps: EditorLinkDeps = { site: () => SITE, ask, follow: () => {} };

function editorSpans(line: string): Span[] {
  const state = EditorState.create({ doc: line });
  return linkHitsBetween(state, 0, line.length, editorDeps).map((hit) => {
    // After T164 the hit carries its kind (data-model §13.2); before it, every hit is a file link.
    const h = hit as unknown as { kind?: 'web' | 'file'; uri?: string; link?: ResolvedLink; position?: LinkPosition };
    const kind = h.kind ?? 'file';
    return {
      kind,
      start: hit.from,
      end: hit.to,
      target: kind === 'web' ? h.uri : h.link?.path,
      ...(h.position === undefined ? {} : { position: h.position }),
    };
  });
}

/** Both producers, after main has answered everything either of them asked. */
async function spansOf(line: string): Promise<{ terminal: Span[]; editor: Span[] }> {
  terminalSpans(line);
  editorSpans(line);
  await resolvePending();
  return { terminal: terminalSpans(line), editor: editorSpans(line) };
}

/* ── The click outcome, through the one router both surfaces call ─────────────────────────── */

const osCalls: string[] = [];

async function clickOutcome(span: Span, text: string): Promise<string> {
  if (span.kind === 'web') return `web:${span.target}`;
  const request: LinkResolutionRequest = { text, kind: 'detectedPath', ...SITE };
  const resolution = answers.get(keyOf(request)) ?? (await resolver.resolve(request));
  const performed: string[] = [];
  osCalls.length = 0;
  const deps: LinkFollowDeps = {
    openInEditor: (l, p) => void performed.push(p ? `editor@${p.line}:${l.path}` : `editor:${l.path}`),
    openInPreview: (l) => void performed.push(`preview:${l.path}`),
    reportFailure: (o) => void performed.push(`failure:${o.reason}`),
    ...linkRouting(
      () =>
        ({
          previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
          previewSettings: previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
        }) as unknown as LinkRoutingInputs,
    ),
  };
  await followLink({
    request,
    ...(span.position === undefined ? {} : { position: span.position }),
    resolve: () => resolution,
    deps,
  });
  return [...performed, ...osCalls].join(',');
}

let LINES: string[] = [];

beforeAll(() => {
  LINES = readFileSync(FIXTURE, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
});

beforeEach(() => {
  answers.clear();
  pending.clear();
  vi.useFakeTimers(); // the terminal provider's held-reply deadline must not outlive a test
  vi.stubGlobal('window', {
    throng: {
      links: {
        reveal: (r: LinkResolutionRequest) => {
          osCalls.push(`osExplorer:${r.text}`);
          return Promise.resolve({ ok: true as const });
        },
        open: (r: LinkResolutionRequest) => {
          osCalls.push(`osDefaultProgram:${r.text}`);
          return Promise.resolve({ ok: true as const });
        },
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('T163 — the parity fixture', () => {
  it('is there, and covers the kinds it claims to', () => {
    expect(LINES.length).toBeGreaterThan(20);
    expect(LINES.some((l) => l.includes('https://'))).toBe(true);
    expect(LINES.some((l) => l.includes('FileSystem::'))).toBe(true);
    expect(LINES.some((l) => l.startsWith('file:///'))).toBe(true);
  });
});

describe('SC-012 / FR-104 — every fixture line yields the SAME spans, kinds and targets in both panel types', () => {
  it('line by line', async () => {
    const disagreements: string[] = [];
    for (const line of LINES) {
      const { terminal, editor } = await spansOf(line);
      const t = JSON.stringify(terminal.map(({ kind, start, end, target }) => ({ kind, start, end, target })));
      const e = JSON.stringify(editor.map(({ kind, start, end, target }) => ({ kind, start, end, target })));
      if (t !== e) disagreements.push(`${JSON.stringify(line)}\n    terminal: ${t}\n    editor:   ${e}`);
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });

  it('FR-100: a line carrying a web URL yields a WEB span in both panel types', async () => {
    const missing: string[] = [];
    for (const line of LINES.filter((l) => /https?:\/\//.test(l))) {
      const { terminal, editor } = await spansOf(line);
      if (!terminal.some((s) => s.kind === 'web')) missing.push(`terminal: ${line}`);
      if (!editor.some((s) => s.kind === 'web')) missing.push(`editor: ${line}`);
    }
    expect(missing).toEqual([]);
  });

  it('FR-009 / D11: no path span overlaps a web span, in either panel type', async () => {
    const overlaps: string[] = [];
    for (const line of LINES.filter((l) => /https?:\/\//.test(l))) {
      const { terminal, editor } = await spansOf(line);
      for (const [surface, spans] of [['terminal', terminal], ['editor', editor]] as const) {
        const web = spans.filter((s) => s.kind === 'web');
        for (const file of spans.filter((s) => s.kind === 'file')) {
          if (web.some((w) => file.start < w.end && w.start < file.end)) overlaps.push(`${surface}: ${line}`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('every span has the same click outcome from both panel types', async () => {
    const disagreements: string[] = [];
    for (const line of LINES) {
      const { terminal, editor } = await spansOf(line);
      const t: string[] = [];
      for (const s of terminal) t.push(await clickOutcome(s, line.slice(s.start, s.end)));
      const e: string[] = [];
      for (const s of editor) e.push(await clickOutcome(s, line.slice(s.start, s.end)));
      if (JSON.stringify(t) !== JSON.stringify(e)) disagreements.push(`${line}: terminal ${JSON.stringify(t)} / editor ${JSON.stringify(e)}`);
    }
    expect(disagreements).toEqual([]);
  });
});

describe('FR-106 — one in-project file, spelled every way, opens in throng from BOTH panel types', () => {
  const SPELLINGS = [
    'src/foo.ts',
    './src/foo.ts',
    '/src/foo.ts',
    'D:\\p\\src\\foo.ts',
    'D:/p/src/foo.ts',
    '/d/p/src/foo.ts',
    '/mnt/d/p/src/foo.ts',
    '~/p/src/foo.ts',
    'file:///D:/p/src/foo.ts',
    'FileSystem::D:\\p\\src\\foo.ts',
    'Microsoft.PowerShell.Core\\FileSystem::D:\\p\\src\\foo.ts',
  ];

  it('each spelling is in the fixture', () => {
    expect(SPELLINGS.filter((s) => !LINES.includes(s))).toEqual([]);
  });

  it('each opens D:\\p\\src\\foo.ts in an editor, from the terminal and from the editor', async () => {
    const wrong: string[] = [];
    for (const spelling of SPELLINGS) {
      const { terminal, editor } = await spansOf(spelling);
      for (const [surface, spans] of [['terminal', terminal], ['editor', editor]] as const) {
        const files = spans.filter((s) => s.kind === 'file');
        if (files.length !== 1) {
          wrong.push(`${surface} / ${spelling}: ${files.length} file spans`);
          continue;
        }
        const outcome = await clickOutcome(files[0]!, spelling.slice(files[0]!.start, files[0]!.end));
        if (outcome !== `editor:${ROOT}\\src\\foo.ts` && normaliseForCompare(outcome.replace(/^editor:/, '')) !== normaliseForCompare(`${ROOT}\\src\\foo.ts`)) {
          wrong.push(`${surface} / ${spelling}: ${outcome || '(nothing)'}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
