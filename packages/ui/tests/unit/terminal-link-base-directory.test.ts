import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import { __resetLinkCacheForTests } from '../../src/renderer/links/link-cache.js';
import {
  createFileLinkProvider,
  type LinkProviderTerminal,
} from '../../src/renderer/terminal/file-link-provider.js';
import {
  askTerminalLink,
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

beforeEach(() => {
  asked = [];
  vi.stubGlobal('window', {
    throng: {
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
          asked.push(request);
          return { ok: false };
        },
      },
    },
  });
  __resetLinkCacheForTests();
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

describe('the provider re-reads it, so a `cd` changes what the next hover means', () => {
  it('asks against the directory the terminal is in NOW, not the one it started in', () => {
    const terminal = new FakeTerminal();
    terminal.write('built src/foo.ts');

    let cwd = 'D:\\p';
    const provider = createFileLinkProvider({
      terminal,
      site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: cwd }),
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });

    provider.provideLinks(1, () => {});
    cwd = 'D:\\p\\packages\\ui'; // the user typed `cd packages/ui`
    provider.provideLinks(1, () => {});

    expect(asked.map((r) => r.baseDirectory)).toEqual(['D:\\p', 'D:\\p\\packages\\ui']);
  });
});
