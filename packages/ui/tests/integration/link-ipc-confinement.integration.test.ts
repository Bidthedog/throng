import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewSettings } from '@throng/core';
import { WindowsExecutableExtensions, WindowsPathForms } from '@throng/platform-windows';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FileLinkResolver } from '../../src/main/file-link-resolver.js';
import { registerLinkIpc, type LinkIpcMain } from '../../src/main/link-ipc.js';

/**
 * 045 I1/I2, FR-037, FR-055 and T004's FR-035a — **what a renderer cannot talk main into.**
 *
 * `link-ipc.contract.test.ts` pins the wire against a fake service. This drives the SAME handlers
 * over the real `FileLinkResolver` and a real temp tree, because the two halves of the confinement
 * only meet here: the handler drops a renderer's claims, and the resolver derives the root itself.
 * Either one alone looks like it works.
 *
 * The attacks below are the ones the design is actually shaped against — a renderer naming an
 * absolute path outside the project, naming a project root it does not own, or naming a panel that
 * belongs to someone else. None of them is exotic: a compromised renderer is 024 FR-019b's premise,
 * and every one of these would otherwise be a way to reveal or open an arbitrary file.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/links', import.meta.url));

let root = '';
let base = '';

type Listener = (event: unknown, payload: unknown) => unknown;

function fakeIpc(): LinkIpcMain & { handles: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  return {
    handles,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: () => {},
  };
}

/**
 * Main's own project cache, keyed by project ID — the same shape `authoritative()` reads
 * (`editor-ipc.ts:71-83`). The renderer names an ID; the ROOT is looked up here and nowhere else.
 */
const PROJECT_ROOTS = new Map<string, string>();

function wired() {
  const settings: PreviewSettings = {
    updateDelayMs: 300,
    maxWaitMs: 1000,
    copyFormat: 'rich',
    syncScroll: true,
    providers: { markdown: { enabled: true, defaultOpenAction: 'editor' } },
  };
  const revealed: string[] = [];
  const resolver = new FileLinkResolver({
    fs: new NodeFileSystem(async () => {}),
    pathForms: new WindowsPathForms(),
    executables: new WindowsExecutableExtensions(),
    // I2: main's own answer. The renderer names a project ID it legitimately owns; the ROOT is
    // derived here, and there is no parameter by which a renderer could supply one.
    projectRootFor: (projectId) =>
      projectId === undefined ? null : (PROJECT_ROOTS.get(projectId) ?? null),
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    readPreviewSettings: () => settings,
  });
  resolver.setShell({
    revealInFileManager: async (p) => void revealed.push(p),
    openFolder: async (p) => void revealed.push(p),
    openExternal: async () => {},
    openWithDefaultProgram: async (p) => void revealed.push(p),
  });
  const ipc = fakeIpc();
  registerLinkIpc(ipc, resolver);
  return { ipc, revealed };
}

const event = { sender: { id: 1 } };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'throng-link-confine-'));
  root = join(base, 'project');
  cpSync(FIXTURES, root, { recursive: true });
  PROJECT_ROOTS.set('proj-1', root);
});

afterAll(() => {
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* a temp tree left behind is not worth failing a passing assertion over */
  }
});

describe('I1 \u2014 the request carries a LINK, and a renderer-supplied path is ignored', () => {
  it('an absolute path smuggled beside the text does not become the target', async () => {
    const { ipc, revealed } = wired();
    await ipc.handles.get('throng:links:reveal')!(event, {
      text: 'test.txt',
      kind: 'detectedPath',
      panelId: 'p1',
      originProjectId: 'proj-1',
      // What a renderer would send if the channel took a path. It does not.
      absPath: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
      path: 'C:\\Windows\\System32',
    });
    expect(revealed).toEqual([join(root, 'test.txt')]);
  });

  it('the resolved target is always re-derived from the text, never echoed back', async () => {
    const { ipc } = wired();
    const answer = (await ipc.handles.get('throng:links:resolve')!(event, {
      text: 'src/foo.ts',
      kind: 'detectedPath',
      panelId: 'p1',
      originProjectId: 'proj-1',
      path: 'C:\\somewhere\\else.ts',
    })) as { ok: true; link: { path: string } };
    expect(answer.ok).toBe(true);
    expect(answer.link.path).toBe(join(root, 'src', 'foo.ts'));
  });
});

describe('I2 \u2014 the renderer names a project ID; MAIN derives the root', () => {
  it('a renderer-claimed project ROOT changes nothing about the verdict', async () => {
    const { ipc } = wired();
    const answer = (await ipc.handles.get('throng:links:resolve')!(event, {
      text: 'test.txt',
      kind: 'detectedPath',
      panelId: 'p2',
      // A renderer trying to acquire a project by naming its root outright. The only field that
      // buys anything is `originProjectId`, and this request names none.
      projectRoot: root,
      inProject: true,
    })) as { ok: boolean; link?: { inProject: boolean } };
    // No project id, so no root, so a relative path resolves against nothing at all.
    expect(answer.ok).toBe(false);
  });

  it('naming the right project ID DOES resolve \u2014 the id is the renderer\u2019s to give', async () => {
    // The other half of the rule, and the one that keeps it honest: if nothing a renderer sent ever
    // mattered, the first case above would pass for the wrong reason.
    const { ipc } = wired();
    const answer = (await ipc.handles.get('throng:links:resolve')!(event, {
      text: 'test.txt',
      kind: 'detectedPath',
      panelId: 'p2',
      originProjectId: 'proj-1',
    })) as { ok: true; link: { path: string; inProject: boolean } };
    expect(answer.ok).toBe(true);
    expect(answer.link.path).toBe(join(root, 'test.txt'));
    expect(answer.link.inProject).toBe(true);
  });

  it('a project ID main has never heard of gets no root, and no membership', async () => {
    const { ipc } = wired();
    const answer = (await ipc.handles.get('throng:links:resolve')!(event, {
      text: join(root, 'test.txt'),
      kind: 'detectedPath',
      panelId: 'p3',
      originProjectId: 'no-such-project',
    })) as { ok: true; link: { inProject: boolean } };
    expect(answer.ok).toBe(true);
    expect(answer.link.inProject, 'FR-055 depends on this being false').toBe(false);
  });

  it('a request with NO panelId is refused before it reaches the resolver', async () => {
    const { ipc, revealed } = wired();
    const answer = await ipc.handles.get('throng:links:reveal')!(event, {
      text: join(root, 'test.txt'),
      kind: 'detectedPath',
    });
    expect(answer).toMatchObject({ ok: false });
    expect(revealed).toEqual([]);
  });
});

describe('FR-035a \u2014 the third reveal policy, and what it deliberately does NOT do', () => {
  it('reveals a file OUTSIDE every project root, which neither existing policy can', async () => {
    // This is the whole reason FR-035a exists: `throng:files:reveal` is confined by a path prefix
    // and `throng:files:revealDocument` refuses any path no panel has open. A link to a file
    // outside the project, that nothing has open, is exactly the case FR-030 requires to work.
    const outsideFile = join(base, 'outside.txt');
    cpSync(join(root, 'test.txt'), outsideFile);
    const { ipc, revealed } = wired();
    const answer = await ipc.handles.get('throng:links:reveal')!(event, {
      text: outsideFile,
      kind: 'detectedPath',
      panelId: 'p1',
      originProjectId: 'proj-1',
    });
    expect(answer).toEqual({ ok: true });
    expect(revealed).toEqual([outsideFile]);
  });

  // *Round four (T255, FR-158b / S10):* this case asserted that a reveal of a path that does not exist
  // was refused as `gone`. FR-158b makes the explicit Open in OS Explorer item reveal a missing location
  // on its PARENT instead. The confinement is unchanged — it is RE-RESOLUTION from the request: what
  // reaches the OS is derived by main from the text, never a path the renderer supplied (I1 above).
  it('a path that does not exist is revealed on its parent \u2014 still derived from the text, not taken', async () => {
    const { ipc, revealed } = wired();
    const answer = await ipc.handles.get('throng:links:reveal')!(event, {
      text: 'C:\\Windows\\System32\\throng-no-such-thing.dll',
      kind: 'detectedPath',
      panelId: 'p1',
      originProjectId: 'proj-1',
      absPath: 'C:\\Users',
    });
    expect(answer).toEqual({ ok: true });
    expect(revealed).toEqual(['C:\\Windows\\System32']);
  });

  it('Open in OS Default Program on a path that does not exist is still refused as gone (FR-037)', async () => {
    const { ipc, revealed } = wired();
    const answer = await ipc.handles.get('throng:links:open')!(event, {
      text: 'C:\\Windows\\System32\\throng-no-such-thing.dll',
      kind: 'detectedPath',
      panelId: 'p1',
      originProjectId: 'proj-1',
    });
    expect(answer).toMatchObject({ ok: false, reason: 'gone' });
    expect(revealed).toEqual([]);
  });
});

describe('FR-055 \u2014 nothing outside the project is ever reported as inside it', () => {
  it('over every panel and every spelling the channel accepts', async () => {
    const { ipc } = wired();
    const outsideFile = join(base, 'outside.txt');
    cpSync(join(root, 'test.txt'), outsideFile);
    // A panel in the fixture project, one with no project at all, and one naming a project main
    // has never heard of — the three shapes `originProjectId` can arrive in.
    for (const originProjectId of ['proj-1', undefined, 'no-such-project']) {
      for (const text of [outsideFile, outsideFile.replace(/\\/g, '/')]) {
        const answer = (await ipc.handles.get('throng:links:resolve')!(event, {
          text,
          kind: 'detectedPath',
          panelId: 'p1',
          originProjectId,
        })) as { ok: boolean; link?: { inProject: boolean } };
        if (answer.ok) expect(answer.link!.inProject, `${originProjectId} / ${text}`).toBe(false);
      }
    }
  });
});

describe('the two existing reveal policies keep their own confinements', () => {
  it('neither is registered by registerLinkIpc, and neither is referenced by it', () => {
    const { ipc } = wired();
    expect([...ipc.handles.keys()]).not.toContain('throng:files:reveal');
    expect([...ipc.handles.keys()]).not.toContain('throng:files:revealDocument');
    const source = readLinkIpcSource();
    expect(source).not.toContain('throng:files:reveal');
    expect(source).not.toContain('revealDocument');
  });
});

function readLinkIpcSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(
    fileURLToPath(new URL('../../src/main/link-ipc.ts', import.meta.url)),
    'utf8',
  );
}
