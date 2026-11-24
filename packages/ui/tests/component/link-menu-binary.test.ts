import { afterEach, describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  previewSettingsDefaults,
  type LinkResolution,
  type LinkResolutionRequest,
} from '@throng/core';
import { openFileLinkMenu } from '../../src/renderer/links/file-link-menu.js';
import type { LinkMenuOpener } from '../../src/renderer/links/open-link-or-panel-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * #719 — a file the editor refuses as binary (067 FR-117's meaning: a PDF, an image, a spreadsheet, or any
 * file main's open decision refuses as `binary`) is never offered an editor on the Link menu: no Open In ▸
 * New Editor, Active Editor or named editor (045 FR-170e). Driven through `openFileLinkMenu`, the one
 * opener a terminal, an editor and a preview share, with main answered at the bridge.
 */

const ROOT = 'D:/p';

function bridge(link: LinkResolution, decision: unknown): void {
  Reflect.set(window, 'throng', {
    links: { resolve: () => Promise.resolve(link) },
    editor: {
      isOpen: () => Promise.resolve(false),
      openInto: () => Promise.resolve(decision),
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/** Open the Link menu over `text`; resolves with the menu as first drawn and as main's answer leaves it. */
async function openMenu(text: string): Promise<{ first: MenuAction[]; settled: MenuAction[] }> {
  let first: MenuAction[] = [];
  let settled: MenuAction[] | undefined;
  let done: () => void = () => {};
  const updated = new Promise<void>((resolve) => {
    done = resolve;
  });
  const opener: LinkMenuOpener = {
    openMenu: (_x, _y, items) => {
      first = items;
      return 1;
    },
    updateMenu: (_id, items) => {
      settled = items;
      done();
    },
  };
  const request: LinkResolutionRequest = { text, kind: 'detectedPath', panelId: 'panel-1', originProjectId: 'proj' };
  openFileLinkMenu({
    x: 0,
    y: 0,
    opener,
    ws: { layout: null } as unknown as Parameters<typeof openFileLinkMenu>[0]['ws'],
    request,
    projectRoot: ROOT,
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
    openLink: () => {},
    deps: {} as Parameters<typeof openFileLinkMenu>[0]['deps'],
  });
  await updated;
  return { first, settled: settled ?? [] };
}

const labels = (items: MenuAction[]): (string | undefined)[] => items.map((i) => i.label);
const BINARY = { action: 'refuse', reason: 'binary' };
const fileLink = (path: string, preview: 'none' | 'enabled' | 'disabled'): LinkResolution => ({
  ok: true,
  link: { path, kind: 'file', inProject: true, executable: false, preview },
});

describe('the Link menu offers no editor for a binary file (#719, 045 FR-170e)', () => {
  it('a PDF in the project: no Open In ▸, before or after main answers', async () => {
    bridge(fileLink(`${ROOT}/report.pdf`, 'enabled'), BINARY);
    const { first, settled } = await openMenu(`${ROOT}/report.pdf`);
    expect(labels(first)).not.toContain('Open In');
    expect(labels(settled)).not.toContain('Open In');
    // Its preview and the OS routes stay on offer.
    expect(labels(settled)).toContain('Open Preview');
    expect(labels(settled)).toContain('Open in OS Default Program');
  });

  it('a file no provider claims that main refuses as binary: no Open In ▸ once main answers', async () => {
    bridge(fileLink(`${ROOT}/blob.dat`, 'none'), BINARY);
    const { settled } = await openMenu(`${ROOT}/blob.dat`);
    expect(labels(settled)).not.toContain('Open In');
    expect(labels(settled)).toContain('Open in OS Default Program');
  });

  it('control: a text file keeps Open In ▸', async () => {
    bridge(fileLink(`${ROOT}/notes.txt`, 'none'), { action: 'open' });
    const { settled } = await openMenu(`${ROOT}/notes.txt`);
    expect(labels(settled)).toContain('Open In');
  });
});
