import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flavourReportsDirectory, type LinkResolution, type LinkResolutionRequest } from '@throng/core';
import * as activation from '../../src/renderer/terminal/terminal-link-activation.js';
import {
  createFileLinkProvider,
  type LinkProviderTerminal,
} from '../../src/renderer/terminal/file-link-provider.js';
import {
  terminalLinkRequest,
  type TerminalLinkSite,
} from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T072 (FR-023) — what a relative path printed in a terminal is measured from.
 *
 * ══ THE LIVE DIRECTORY, NOT THE PROJECT ROOT, NOT THE START DIRECTORY ══
 *
 * `npm run build` in `packages/ui` prints `src/foo.ts` and means `packages/ui/src/foo.ts`. Resolving
 * that against the project root would open a different file, or — more often, and worse — no file at
 * all, so the path silently stops being a link the moment the user `cd`s anywhere. The base
 * directory is therefore the terminal's CURRENT working directory, read at the moment of the hover,
 * and the project root is what main tries second (R1).
 *
 * ══ AND ABSENT WHEN THRONG DOES NOT KNOW IT ══
 *
 * throng's knowledge of a shell's directory is not guaranteed: PowerShell's `Set-Location` never
 * moves the process working directory, so without shell integration there is nothing to report and
 * the store is empty. An absent base directory is the honest answer, and main then resolves against
 * the project root alone. Inventing one — the start directory, the root — would make a relative path
 * resolve to a file the user is not looking at, which is worse than it not being a link.
 */

const SITE_WITH_CWD: TerminalLinkSite = {
  panelId: 'panel-1',
  originProjectId: 'project-1',
  baseDirectory: 'D:\\p\\packages\\ui',
};

class FakeTerminal implements LinkProviderTerminal {
  readonly rows: string[] = [];
  buffer = {
    active: {
      getLine: (index: number) =>
        this.rows[index] === undefined
          ? undefined
          : { translateToString: () => this.rows[index] as string },
    },
  };
  write(line: string): void {
    this.rows.push(line);
  }
}

let asked: LinkResolutionRequest[];
let followed: LinkResolutionRequest[];

beforeEach(() => {
  asked = [];
  followed = [];
  vi.stubGlobal('window', {
    throng: {
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
          asked.push(request);
          return { ok: false };
        },
        follow: async (request: LinkResolutionRequest) => {
          followed.push(request);
          return { kind: 'revealed' };
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request carries the live working directory (FR-023)', () => {
  it('names it as the base directory when throng knows it', () => {
    expect(terminalLinkRequest({ text: 'src/foo.ts', kind: 'detectedPath', site: SITE_WITH_CWD }))
      .toEqual({
        text: 'src/foo.ts',
        kind: 'detectedPath',
        panelId: 'panel-1',
        originProjectId: 'project-1',
        baseDirectory: 'D:\\p\\packages\\ui',
      });
  });

  it('omits it entirely when throng does not — never a substitute', () => {
    const request = terminalLinkRequest({
      text: 'src/foo.ts',
      kind: 'detectedPath',
      site: { panelId: 'panel-1', originProjectId: 'project-1' },
    });
    expect('baseDirectory' in request).toBe(false);
  });

  it('omits the project too, for a panel that belongs to none (M3)', () => {
    const request = terminalLinkRequest({
      text: 'src/foo.ts',
      kind: 'detectedPath',
      site: { panelId: 'panel-1' },
    });
    expect(request).toEqual({ text: 'src/foo.ts', kind: 'detectedPath', panelId: 'panel-1' });
  });
});

/*
 * 045 T293 (FR-023 / FR-144): this pinned the property on the HOVER's ask. Round four asks nothing to
 * draw a link (FR-155), so the property now lives on the FOLLOW request: the base directory is the one
 * the terminal is in at the moment of the click, not the one it was in when the link was drawn.
 */
describe('the follow re-reads it, so a `cd` changes what the next Ctrl+click means', () => {
  it('follows against the directory the terminal is in NOW, not the one it was drawn in', async () => {
    const terminal = new FakeTerminal();
    terminal.write('built src/foo.ts');

    let cwd = 'D:\\p';
    const provider = createFileLinkProvider({
      detect: () => true,
      terminal,
      site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: cwd }),
      ask: () => undefined, // nothing has answered anything
      onHover: () => {},
      follow: ({ request, position }: { request: LinkResolutionRequest; position?: { line: number } }) =>
        void activation.followTerminalLink({
          request,
          ...(position === undefined ? {} : { position }),
          deps: { openInEditor: () => {}, openInPreview: () => {}, reportFailure: () => {} },
        }),
    } as unknown as Parameters<typeof createFileLinkProvider>[0]);

    let links: { activate(e: MouseEvent, t: string): void }[] = [];
    provider.provideLinks(1, (provided) => {
      links = provided ?? [];
    });
    expect(links, 'drawn with nothing answered').toHaveLength(1);
    cwd = 'D:\\p\\packages\\ui'; // the user typed `cd packages/ui` — the link is not redrawn
    links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'src/foo.ts');
    await Promise.resolve();

    expect(followed.map((r) => r.baseDirectory)).toEqual(['D:\\p\\packages\\ui']);
    expect(asked, 'no resolve to draw it, and none to follow it').toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T188 — FR-142 – FR-144 (P14; data-model §14.4): every terminal flavour
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today: a terminal whose shell CANNOT report its directory — PowerShell or Git
 * Bash with `terminals.shellIntegration` off, or a WSL flavour — still offers the cwd store's value as
 * the base directory. For those shells that value is the LAUNCH directory (the observed process
 * directory, which `Set-Location` and a Linux `cd` never move), so after `cd sub` a relative path is
 * resolved against the folder the user left: it opens the wrong file, or is no link at all.
 *
 * ══ THE SEAM, AND WHY IT IS NAMED HERE ══
 *
 * Today the site's base directory is computed inside `terminal-panel.tsx`'s render
 * (`linkBaseDirectory: () => peekTerminalCwd(panel.id)`), a React closure a node-environment unit
 * test cannot reach — there is no pure function to call. data-model §14.4 states the rule as a
 * formula, and T189 must put it somewhere; this test names that somewhere as
 * `terminalLinkBaseDirectory` in `terminal-link-activation.ts`, beside `terminalLinkRequest`, which
 * is the module the site type already lives in. The platform's "is this flavour WSL?" answer is an
 * INPUT (`isWsl`), because recognising WSL is an OS fact that belongs behind the platform abstraction
 * (FR-144), not in the renderer. T189 may choose another name; if it does, it renames the lookup
 * below and nothing else.
 *
 * Looked up by name rather than imported so the file's existing cases keep running while the export
 * is absent — a missing export must fail THESE cases, not the whole file.
 */
type BaseDirectoryFor = (args: {
  readonly flavourId: string;
  readonly shellIntegration: boolean;
  readonly isWsl: boolean;
  /** The cwd store's value for the panel — observed (cmd) or reported (OSC 9;9), or the launch dir. */
  readonly cwd: string | undefined;
}) => string | undefined;

function baseDirectoryFor(): BaseDirectoryFor {
  const found = (activation as Record<string, unknown>).terminalLinkBaseDirectory;
  expect(
    typeof found,
    'terminal-link-activation.ts exports terminalLinkBaseDirectory — the link site\u2019s base-directory rule',
  ).toBe('function');
  return found as BaseDirectoryFor;
}

/** The four built-in flavours (`windows-shell-detection.ts`; 005 FR-024). WSL is not one of them. */
const BUILT_IN = ['cmd', 'windows-powershell', 'pwsh', 'git-bash'] as const;
const CWD = 'D:\\p\\packages\\ui';

describe('T188 / FR-142 – FR-143 — each built-in flavour, integration on and off', () => {
  for (const flavourId of BUILT_IN) {
    for (const shellIntegration of [true, false]) {
      const reports = flavourReportsDirectory(flavourId, shellIntegration);
      it(`${flavourId}, shell integration ${shellIntegration ? 'on' : 'off'}: ${
        reports ? 'the cwd store\u2019s value' : 'NO base directory, never the launch directory'
      }`, () => {
        const base = baseDirectoryFor()({ flavourId, shellIntegration, isWsl: false, cwd: CWD });
        expect(base).toBe(reports ? CWD : undefined);

        const request = terminalLinkRequest({
          text: 'src/foo.ts',
          kind: 'detectedPath',
          site: { panelId: 'panel-1', originProjectId: 'project-1', ...(base ? { baseDirectory: base } : {}) },
        });
        if (reports) expect(request.baseDirectory).toBe(CWD);
        else expect('baseDirectory' in request, 'R5 then tries the project root alone').toBe(false);
      });
    }
  }

  it('the matrix is what 025 says: cmd always reports; the other three only with integration on', () => {
    // A characterisation pin on the INPUT, so a change to 025's rule shows up here by name.
    expect(BUILT_IN.map((id) => [id, flavourReportsDirectory(id, true), flavourReportsDirectory(id, false)])).toEqual([
      ['cmd', true, true],
      ['windows-powershell', true, false],
      ['pwsh', true, false],
      ['git-bash', true, false],
    ]);
  });
});

describe('T188 / FR-144 — a user-defined WSL flavour gets NO base directory', () => {
  it('flavourReportsDirectory says a user-defined flavour reports — the reason FR-144 needs one more input', () => {
    // data-model §14.4's caution, pinned: this is TRUE today, for any flavour outside the maps, and
    // 045 does not change it (025's own callers are left alone). The link base must not believe it.
    expect(flavourReportsDirectory('wsl-ubuntu', true)).toBe(true);
    expect(flavourReportsDirectory('wsl-ubuntu', false)).toBe(true);
  });

  for (const shellIntegration of [true, false]) {
    it(`a WSL flavour, integration ${shellIntegration ? 'on' : 'off'}: no base directory, whatever the store holds`, () => {
      const base = baseDirectoryFor()({
        flavourId: 'wsl-ubuntu',
        shellIntegration,
        isWsl: true,
        // What the store holds for wsl.exe: its Windows-side LAUNCH directory, which a Linux `cd` never moves.
        cwd: 'D:\\p',
      });
      expect(base, 'a Linux `cd` is invisible to Windows; the launch directory is stale').toBeUndefined();
    });
  }
});
