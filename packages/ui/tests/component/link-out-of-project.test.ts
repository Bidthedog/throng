import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_LINK_ACTIONS,
  LINK_TARGETS,
  SHIPPED_PREVIEW_PROVIDERS,
  fileLinkMenuItems,
  previewSettingsDefaults,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import {
  followLink,
  linkRouting,
  osLinkActions,
  performLinkTarget,
  type LinkFollowDeps,
  type LinkRoutingInputs,
} from '../../src/renderer/links/link-actions.js';
import { fileLinkMenuActions } from '../../src/renderer/links/link-menu-items.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import { followLinkAtCaret, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T110, FR-055 / SC-007 — **nothing outside the owning project opens in a throng editor or
 * preview.** Not by a gesture, not by a menu item, not by any setting.
 *
 * ══ WHY IT IS ASSERTED EXHAUSTIVELY RATHER THAN CASE BY CASE ══
 *
 * This is the failure with nothing to see. There is no error, no refusal, no notice — just a file
 * that should not have opened, in a panel where it looks exactly like one that should. A reviewer
 * cannot spot it, and a user would not report it as a bug. So it is asserted over the CROSS PRODUCT
 * of everything a user can reach: every fixture in `tests/fixtures/links/`, every setting, every
 * gesture and every named menu row.
 *
 * ══ THREE WAYS TO BE OUT OF PROJECT, AND ALL THREE MATTER ══
 *
 * 1. A path outside every project (`C:\Windows\notepad.exe`).
 * 2. A path inside **another throng project** — the one that looks most like it should open, because
 *    throng really does know that file.
 * 3. A panel with **no owning project** at all (a sub-workspace's own panel), where main answers
 *    `inProject: false` for everything because there is no root to be inside (M3).
 *
 * The renderer cannot tell them apart and must not try: `inProject` is main's single answer, derived
 * in main from the project ID the renderer named (I2). What this file proves is that the renderer
 * acts on that one bit consistently, whichever of the three produced it.
 */

// Resolved from the runner's own root rather than from `import.meta.url`: under jsdom the module's
// url is not a `file:` one, and `fileURLToPath` throws on it before a single assertion runs.
const FIXTURES = `${resolve(process.cwd(), 'packages/ui/tests/fixtures/links')}/`;

/** Every file the fixture tree holds, as a link text a user could click. */
function fixtureNames(): string[] {
  const names: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`, `${prefix}${entry.name}/`);
      else names.push(`${prefix}${entry.name}`);
    }
  };
  walk(FIXTURES, '');
  return names;
}

const NAMES = fixtureNames();

/** The three ways a link ends up out of project, as the absolute path main would answer with. */
const OUTSIDE = [
  ['outside every project', (name: string) => `C:\\elsewhere\\${name.replace(/\//g, '\\')}`],
  ['inside ANOTHER throng project', (name: string) => `D:\\other-project\\${name.replace(/\//g, '\\')}`],
  ['a panel with no owning project', (name: string) => `D:\\p\\${name.replace(/\//g, '\\')}`],
] as const;

let live: LinkRoutingInputs;
const osCalls: string[] = [];

beforeEach(() => {
  live = {
    defaultAction: 'throng',
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
  };
  osCalls.length = 0;
  (window as unknown as { throng: unknown }).throng = {
    links: {
      reveal: () => {
        osCalls.push('osExplorer');
        return Promise.resolve({ ok: true as const });
      },
      open: () => {
        osCalls.push('osDefaultProgram');
        return Promise.resolve({ ok: true as const });
      },
    },
  };
});

interface Surface {
  readonly deps: LinkFollowDeps;
  readonly opened: string[];
}

function surface(): Surface {
  const opened: string[] = [];
  return {
    opened,
    deps: {
      openInEditor: (l) => void opened.push(`editor:${l.path}`),
      openInPreview: (l) => void opened.push(`preview:${l.path}`),
      reportFailure: () => {},
      ...linkRouting(() => live),
    },
  };
}

/** Out of project, with every OTHER bit as favourable to opening as it can be. */
const outsideLink = (path: string): ResolvedLink => ({
  path,
  kind: 'folder' === path ? 'folder' : 'file',
  inProject: false,
  executable: false,
  // `enabled` is the most permissive value there is: the provider handles this type and is ON.
  preview: 'enabled',
});

const answer =
  (resolved: ResolvedLink) =>
  (): LinkResolution => ({ ok: true, link: resolved });

const requestFor = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: 'D:\\p',
  panelId: 'panel-1',
});

async function terminalCtrlClick(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => `at ${text}` }) } } },
    site: () => ({ panelId: 'panel-1', baseDirectory: 'D:\\p' }),
    ask: answer(resolved),
    onHover: () => {},
    follow: ({ request }) => {
      pending = followLink({ request, resolve: answer(resolved), deps: s.deps });
    },
  });
  let links: { activate(event: MouseEvent, text: string): void }[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  if (links.length === 0) return; // the text was not path-shaped; nothing to click
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
  await pending;
}

async function editorChord(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  const doc = `at ${text} here\n`;
  let pending: Promise<void> = Promise.resolve();
  const deps: EditorLinkDeps = {
    site: () => ({ panelId: 'panel-1', baseDirectory: 'D:\\p' }),
    ask: answer(resolved),
    follow: (hit) => {
      pending = followLink({ request: hit.request, resolve: answer(resolved), deps: s.deps });
    },
  };
  const view = {
    state: EditorState.create({ doc, selection: { anchor: doc.indexOf(text) + 1 } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  if (!followLinkAtCaret(view, deps)) return; // not path-shaped here either
  await pending;
}

describe('SC-007 — no gesture opens an out-of-project file in throng', () => {
  it('across the fixture set, every setting, and both gestures', async () => {
    const offenders: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        for (const setting of DEFAULT_LINK_ACTIONS) {
          for (const [gesture, drive] of [
            ['Ctrl+click (terminal)', terminalCtrlClick],
            ['Open Link chord (editor)', editorChord],
          ] as const) {
            live = { ...live, defaultAction: setting };
            const s = surface();
            await drive(outsideLink(toPath(name)), name, s);
            if (s.opened.length > 0) {
              offenders.push(`${name}/${why}/${setting}/${gesture}: ${s.opened.join(',')}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('SC-007 — and no MENU ITEM does either', () => {
  it('the menu offers neither Open in Editor nor Open in Preview for an out-of-project link', () => {
    const offered: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        const items = fileLinkMenuItems(outsideLink(toPath(name)));
        for (const item of items) {
          if (item.id === 'editor' || item.id === 'preview') {
            offered.push(`${name}/${why}: ${item.label}`);
          }
        }
      }
    }
    expect(offered).toEqual([]);
  });

  it('and a row invoked anyway — reaching past FR-030 — still opens nothing', async () => {
    const offenders: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        for (const target of LINK_TARGETS) {
          const s = surface();
          await performLinkTarget({
            target,
            link: outsideLink(toPath(name)),
            request: requestFor(name),
            deps: { ...s.deps, ...osLinkActions() },
          });
          if (s.opened.length > 0) offenders.push(`${name}/${why}/${target}: ${s.opened.join(',')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the rows the menu DOES draw are only the ones that leave the app', () => {
    const drawn = new Set<string>();
    for (const name of NAMES) {
      for (const [, toPath] of OUTSIDE) {
        const s = surface();
        for (const action of fileLinkMenuActions({
          link: outsideLink(toPath(name)),
          request: requestFor(name),
          openLink: () => {},
          deps: { ...s.deps, ...osLinkActions() },
        })) {
          drawn.add(action.label);
        }
      }
    }
    expect([...drawn].sort()).toEqual([
      'Copy Link Address',
      'Open Link',
      'Open in OS Default Program',
      'Open in OS Explorer',
    ]);
  });
});
