import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  SHIPPED_PREVIEW_PROVIDERS,
  normaliseForCompare,
  previewSettingsDefaults,
  type IFileSystem,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
} from '@throng/core';
import { WindowsPathForms } from '@throng/platform-windows';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import type { HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import {
  buildLinkDecorations,
  linkHitsBetween,
  type EditorLinkAt,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';
import * as linkActions from '../../src/renderer/links/link-actions.js';
import { followLink, linkRouting, openWebLink, type LinkFollowDeps, type LinkRoutingInputs } from '../../src/renderer/links/link-actions.js';
import { hoveredLinkMenuText, hoveredLinkTipText } from '../../src/renderer/terminal/hovered-link.js';
import { createLinkMarks } from '../../src/renderer/terminal/link-marks.js';
import { createLinkViewMarks, terminalViewScan } from '../../src/renderer/terminal/link-view-marks.js';
import { logicalLinesBetween } from '../../src/renderer/terminal/logical-line.js';
import { followTerminalLink } from '../../src/renderer/terminal/terminal-link-activation.js';
import type { FileLinkProviderDeps } from '../../src/renderer/terminal/file-link-provider.js';
import { __resetRefusedSchemesForTests } from '../../src/renderer/links/refused-schemes-client.js';

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
 *
 * ══ WHAT THIS FILE DOES NOT COVER ══
 *
 * It compares the TERMINAL and the EDITOR, and it compares spans, kinds, targets and click outcomes —
 * never the WORDING. Both surfaces shared one wrong branch for an allowlisted protocol link, so this
 * suite stayed green while all three surfaces disagreed with FR-168 (review round four, editor M1).
 * `link-wording-parity.test.ts` is the missing half: the three surfaces' tooltip and hint STRINGS,
 * the Markdown preview included.
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
      // Round four (FR-155): nothing is resolved to draw a link, so a span's target is the TEXT main
      // will be asked about; the resolved outcome is compared by `clickOutcome` below.
      target: h === undefined ? undefined : h.kind === 'web' ? h.uri : h.request.text,
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
    const h = hit as unknown as {
      kind?: 'web' | 'file';
      uri?: string;
      request?: LinkResolutionRequest;
      position?: LinkPosition;
    };
    const kind = h.kind ?? 'file';
    return {
      kind,
      start: hit.from,
      end: hit.to,
      target: kind === 'web' ? h.uri : h.request?.text,
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
  // One `throng:links:follow` (T294): main resolves, reveals where that is the outcome, and answers.
  await followLink({
    request,
    ...(span.position === undefined ? {} : { position: span.position }),
    deps,
  });
  return [...performed, ...osCalls].join(',');
}

// Main performs a follow's reveal itself; its shell records what the OS was asked for.
resolver.setShell({
  openFolder: async (p: string) => void osCalls.push(`osExplorer:${p}`),
  revealInFileManager: async (p: string) => void osCalls.push(`osExplorer:${p}`),
  openWithDefaultProgram: async (p: string) => void osCalls.push(`osDefaultProgram:${p}`),
  openExternal: async () => {},
} as never);

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
        follow: (r: LinkResolutionRequest) => resolver.follow(r),
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

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T261 — SC-021's counter (FR-155, FR-161; data-model §16.18)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user meets today: every path on screen costs main an existence check before it is drawn —
 * the terminal holds xterm's reply for it, the editor draws nothing until it lands — so a link on an
 * offline share is invisible for the check's whole timeout, and a busy screen is a stream of `stat`s.
 * FR-155 makes validity syntactic: drawing, hovering, the tooltip and the view pass ask main NOTHING.
 * Main is asked only when the user acts — one `throng:links:follow` per Ctrl+click (FR-161's one bounded
 * pass), at most one `throng:links:resolve` per Link-menu opening — and never for a web, loopback or
 * protocol link, which leaves by `throng:linkUri:openExternal` (SC-021's note).
 *
 * Every surface is handed a counting `ask` in every slot it has ever had one, so a surface that still
 * asks is counted rather than silently starved. Main's side is a real `FileLinkResolver` over the fake
 * disk above, with its `stat`s counted too.
 */
describe('T261 / SC-021 — rendering asks main nothing; a follow asks once; a menu opening at most once', () => {
  const ALLOW: ReadonlySet<string> = new Set(['mailto']);
  const LINES_261 = [
    'see src/foo.ts:3 here', //                         in project, exists (onDevice)
    'see src/missing.ts here', //                       in project, nothing behind it (onDevice)
    'see C:\\elsewhere\\x.ts here', //                  out of project (onDevice)
    'open \\\\fileserver\\home\\notes.txt now', //        UNC
    'open D:\\p\\docs\\ now', //                        a folder by grammar (trailing separator)
    'go https://example.com/a now', //                  web
    'go http://localhost:8080/x now', //                loopback
    'mail mailto:someone@example.com now', //           protocol, allowlisted
  ];
  /** OSC 8 targets a program declared on the rows in view — every class, a dead `file:` one included. */
  const OSC_TARGETS = [
    'file:///D:/p/src/foo.ts',
    'file:///C:/does/not/exist.txt',
    'file:///D:/p',
    'https://example.com/b',
    'mailto:x@example.com',
  ];

  const main = { resolve: 0, follow: 0, reveal: 0, open: 0, stat: 0, external: 0 };
  const counted = new FileLinkResolver({
    fs: {
      stat: async (p: string) => {
        main.stat += 1;
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
  counted.setShell({
    openFolder: async () => {},
    revealInFileManager: async () => {},
    openWithDefaultProgram: async () => {},
    openExternal: async () => {},
  } as never);
  /** `FileLinkResolver.follow` (T294), reached structurally so this file compiles before it exists. */
  const followInMain = (r: LinkResolutionRequest): Promise<unknown> => {
    const follow = (counted as unknown as { follow?: (r: LinkResolutionRequest) => Promise<unknown> }).follow;
    return follow === undefined ? Promise.resolve({ kind: 'revealed' }) : follow.call(counted, r);
  };

  /** What the app wires as a surface's `ask`: fire `throng:links:resolve`, answer "not yet". */
  const countingAsk = (request: LinkResolutionRequest): undefined => {
    void window.throng!.links!.resolve(request);
    return undefined;
  };

  const performed: string[] = [];
  const FOLLOW_DEPS: LinkFollowDeps = {
    openInEditor: (l) => void performed.push(`editor:${l.path}`),
    openInPreview: (l) => void performed.push(`preview:${l.path}`),
    reportFailure: (o) => void performed.push(`failure:${o.reason}`),
  };

  const zero = (): void => {
    for (const k of Object.keys(main) as (keyof typeof main)[]) main[k] = 0;
    performed.length = 0;
  };

  beforeEach(() => {
    zero();
    __resetRefusedSchemesForTests();
    vi.stubGlobal('window', {
      throng: {
        links: {
          resolve: (r: LinkResolutionRequest) => {
            main.resolve += 1;
            return counted.resolve(r);
          },
          follow: (r: LinkResolutionRequest) => {
            main.follow += 1;
            return followInMain(r);
          },
          reveal: (r: LinkResolutionRequest) => {
            main.reveal += 1;
            return counted.revealInFileManager(r);
          },
          open: (r: LinkResolutionRequest) => {
            main.open += 1;
            return counted.openWithDefaultProgram(r);
          },
        },
        linkUri: {
          openExternal: () => void (main.external += 1),
          refusedSchemes: async () => [],
        },
      },
    });
  });

  /* ── the terminal: provide, hover, tooltip, menu text; the view pass over output that never pauses ── */

  function mountTerminal(): { links: () => ProvidedLink[]; hovered: HoveredLink[]; viewPass: (renders: number) => Promise<void> } {
    const rows = [...LINES_261];
    const buffer = {
      getLine: (i: number) =>
        rows[i] === undefined ? undefined : { translateToString: () => rows[i] as string, isWrapped: false },
    };
    const hovered: HoveredLink[] = [];
    const deps = {
      terminal: { buffer: { active: buffer } },
      detect: () => true,
      site: () => SITE,
      ask: countingAsk,
      onHover: (h: HoveredLink | null) => {
        if (h === null) return;
        hovered.push(h);
        hoveredLinkTipText(h, 'Ctrl'); // the tooltip is worded on every hover
        hoveredLinkMenuText(h);
      },
      follow: (args: { request: LinkResolutionRequest; position?: LinkPosition }) =>
        void followTerminalLink({
          request: args.request,
          ...(args.position === undefined ? {} : { position: args.position }),
          deps: FOLLOW_DEPS,
        }),
      openWeb: (_event: MouseEvent, uri: string) => openWebLink(uri, ALLOW),
      scanOptions: () => ({ allowlist: ALLOW }),
    } as unknown as FileLinkProviderDeps;
    const provider = createFileLinkProvider(deps);
    const links = (): ProvidedLink[] => {
      const all: ProvidedLink[] = [];
      for (let y = 1; y <= rows.length; y += 1) {
        provider.provideLinks(y, (provided) => {
          for (const l of provided ?? []) {
            all.push(l);
            l.hover({} as MouseEvent, l.text);
            l.leave();
          }
        });
      }
      return all;
    };

    // The view pass and the marks, as `use-terminal.ts` composes them.
    const marks = createLinkMarks({
      terminal: {
        buffer: { active: { baseY: 0, cursorY: 0 } },
        registerMarker: () => ({ dispose() {} }),
        registerDecoration: () => ({ element: undefined, onRender: () => ({ dispose() {} }), dispose() {} }),
      },
      cols: 80,
      site: () => SITE,
      allowlist: () => ALLOW,
    } as unknown as Parameters<typeof createLinkMarks>[0]);
    let render: () => void = () => {};
    const view = createLinkViewMarks({
      onRender: (listener) => {
        render = listener;
        return () => {};
      },
      onBufferChange: () => () => {},
      logicalLinesInView: () => logicalLinesBetween(buffer, 1, rows.length),
      scan: terminalViewScan({
        // A fresh install's edits ON PURPOSE: this fixture measures parity over the SHIPPED grammar.
        // Parity under an EDITED extension set — where the two halves diverged — is
        // `link-known-extension-follow.test.ts`, which drives the same span through both.
        /*
         * Round five's inverted setting INVERTS THE EMPTY VALUE with it, which is the trap this line
         * fell into once already. `{ added: [], removed: [] }` meant "the shipped list, unedited";
         * `[]` means "no extension ever ends a spaced path". The shipped list is what this test
         * wants, so it says so — and says it by reading the default rather than by spelling a list
         * that would then have to be maintained twice.
         */
        links: () => ({
          protocolAllowlist: ['mailto'],
          knownFileExtensions: DEFAULT_APP_SETTINGS.editor.links.knownFileExtensions,
        }),
        detect: () => true,
      }),
      oscLinksInView: () =>
        OSC_TARGETS.map((uri, i) => ({ uri, range: { start: { x: 1, y: i + 1 }, end: { x: 10, y: i + 1 } } })),
      draw: (drawn) => {
        marks.sync(drawn, null);
        const osc = drawn.find((l) => l.kind === 'osc8');
        if (osc) marks.sync(drawn, osc); // an OSC 8 target hovered, as xterm's own hover reports it
      },
      clear: () => marks.sync([], null),
    });
    const viewPass = async (renders: number): Promise<void> => {
      for (let i = 0; i < renders; i += 1) {
        rows[0] = `${LINES_261[0]} ${'.'.repeat(i % 3)}`; // a spinner repainting in place
        render();
        await vi.advanceTimersByTimeAsync(50);
      }
      view.dispose();
    };
    return { links, hovered, viewPass };
  }

  function mountEditor(): { hits: () => EditorLinkAt[]; follow: (hit: EditorLinkAt) => Promise<void> } {
    const doc = LINES_261.join('\n');
    const state = EditorState.create({ doc });
    const deps = {
      site: () => SITE,
      ask: countingAsk,
      scanOptions: () => ({ allowlist: ALLOW }),
      follow: () => {},
    } as unknown as EditorLinkDeps;
    return {
      hits: () => {
        buildLinkDecorations({ state, visibleRanges: [{ from: 0, to: doc.length }] }, deps); // marks + tooltips
        return linkHitsBetween(state, 0, doc.length, deps);
      },
      follow: async (hit) => {
        if (hit.kind === 'web') {
          openWebLink(hit.uri, ALLOW);
          return;
        }
        await (followLink as unknown as (a: unknown) => Promise<void>)({
          request: hit.request,
          ...(hit.position === undefined ? {} : { position: hit.position }),
          deps: FOLLOW_DEPS,
        });
      },
    };
  }

  it('rendering — provide, hover, tooltip, view pass, in both panel types — makes ZERO calls to main', async () => {
    const terminal = mountTerminal();
    terminal.links();
    await terminal.viewPass(40);
    mountEditor().hits();
    // Anything a surface held for an answer has had every chance to ask by now.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(main, 'nothing asked while drawing').toEqual({ resolve: 0, follow: 0, reveal: 0, open: 0, stat: 0, external: 0 });
  });

  it('rendering draws every link by grammar alone: each path, web, loopback and protocol line is a link in both', async () => {
    const terminal = mountTerminal();
    const tLinks = terminal.links();
    const eHits = mountEditor().hits();
    const tTexts = tLinks.map((l) => l.text).sort();
    const eTexts = eHits.map((h) => (h.kind === 'web' ? h.uri : h.request.text)).sort();
    expect(tTexts).toEqual([
      'C:\\elsewhere\\x.ts',
      'D:\\p\\docs\\',
      '\\\\fileserver\\home\\notes.txt',
      'http://localhost:8080/x',
      'https://example.com/a',
      'mailto:someone@example.com',
      'src/foo.ts',
      'src/missing.ts',
    ]);
    expect(eTexts).toEqual(tTexts);
  });

  for (const text of [
    'src/foo.ts',
    'src/missing.ts',
    'C:\\elsewhere\\x.ts',
    '\\\\fileserver\\home\\notes.txt',
    'D:\\p\\docs\\',
  ]) {
    it(`a Ctrl+click on ${JSON.stringify(text)} sends exactly ONE follow and no resolve — terminal and editor`, async () => {
      const terminal = mountTerminal();
      const link = terminal.links().find((l) => l.text === text);
      expect(link, 'the terminal draws it').toBeDefined();
      zero();
      link!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
      await vi.advanceTimersByTimeAsync(0);
      expect({ follow: main.follow, resolve: main.resolve }, 'terminal').toEqual({ follow: 1, resolve: 0 });

      const editor = mountEditor();
      const hit = editor.hits().find((h) => h.kind === 'file' && h.request.text === text);
      expect(hit, 'the editor draws it').toBeDefined();
      zero();
      await editor.follow(hit!);
      expect({ follow: main.follow, resolve: main.resolve }, 'editor').toEqual({ follow: 1, resolve: 0 });
    });
  }

  for (const uri of ['https://example.com/a', 'http://localhost:8080/x', 'mailto:someone@example.com']) {
    it(`a Ctrl+click on ${uri} asks main nothing about files — it leaves by openExternal`, async () => {
      const link = mountTerminal().links().find((l) => l.text === uri);
      expect(link).toBeDefined();
      zero();
      link!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, uri);
      const hit = mountEditor().hits().find((h) => h.kind === 'web' && h.uri === uri);
      expect(hit).toBeDefined();
      await mountEditor().follow(hit!);
      await vi.advanceTimersByTimeAsync(0);
      expect(main).toEqual({ resolve: 0, follow: 0, reveal: 0, open: 0, stat: 0, external: 2 });
    });
  }

  it('a Link-menu opening on a file link asks main at most ONCE (`resolveLinkForMenu`)', async () => {
    const resolveLinkForMenu = (linkActions as Record<string, unknown>).resolveLinkForMenu as
      | ((request: LinkResolutionRequest) => Promise<unknown>)
      | undefined;
    expect(typeof resolveLinkForMenu, 'link-actions exports the one menu-opening resolution').toBe('function');
    for (const text of ['src/foo.ts', 'src/missing.ts', '\\\\fileserver\\home\\notes.txt']) {
      zero();
      await resolveLinkForMenu!({ text, kind: 'detectedPath', ...SITE });
      expect(main.resolve, text).toBeLessThanOrEqual(1);
      expect(main.follow, text).toBe(0);
    }
    // A folder by grammar: main answers it with no check at all (FR-158d, T255).
    zero();
    await resolveLinkForMenu!({ text: 'D:\\p\\docs\\', kind: 'detectedPath', ...SITE });
    expect(main.resolve).toBeLessThanOrEqual(1);
    expect(main.stat, 'a folder by grammar is never checked').toBe(0);
  });
});
