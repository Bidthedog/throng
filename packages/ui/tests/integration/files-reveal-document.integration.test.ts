/**
 * REPRO for #273 — a Panel reveals ITS OWN file, wherever that file lives.
 *
 * The issue frames this as `files.*` resolving against a process-wide root, and proposes resolving
 * per window instead. That framing does not survive contact with the code: the root is not a
 * property of a WINDOW.
 *
 *   - Only the main window has an explorer (`app.tsx` mounts `FileExplorerPane`;
 *     `subworkspace-app.tsx` does not), and `use-explorer-data.ts` is the only sender of
 *     `throng:files:setRoot`. A sub-workspace window therefore never sets a root at all, so keying
 *     the service by window id would make every `files.*` call there fail rather than answer wrongly.
 *   - A Panel CREATED inside a sub-workspace is ROOTLESS by design: it can open a file from anywhere
 *     on the workstation and belongs to no project. There is no root for it to have.
 *
 * So the root is per-PANEL where it exists at all, and the fix is to stop making a caller that holds
 * an absolute path destroy it. `revealDocument` takes the absolute path, and the open-document
 * registry — not a project root — is what confines it.
 *
 * Both symptoms below are reachable from the panel menu ("Open in OS Explorer",
 * `panel-header-menu.ts:198`, shown whenever the panel has a file path).
 *
 * Layer: integration, over a real `NodeFileSystem` and real temp directories, driving the real IPC
 * registrar through a faked `ipcMain`. No window, focus or shell is involved, so it does not need E2E.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sends = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const invokes = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      sends.set(channel, fn),
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      invokes.set(channel, fn),
  },
}));

const { NodeFileSystem } = await import('../../src/main/node-file-system.js');
const { FilesService } = await import('../../src/main/files-service.js');
const { registerFilesIpc } = await import('../../src/main/files-ipc.js');

/** What the OS file manager was asked to show. */
let revealed: string[] = [];
let openedFolders: string[] = [];
const shell = {
  revealInFileManager: async (abs: string) => {
    revealed.push(abs);
  },
  openFolder: async (abs: string) => {
    openedFolders.push(abs);
  },
  openExternal: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

const watcher = { setRoot: () => {} } as unknown as Parameters<typeof registerFilesIpc>[1];

const anyWindow = { sender: { id: 2 } };

let dataDir: string;
/** The project the MAIN window has active — the root the process-wide `files.*` would resolve under. */
let projectA: string;
/** The project a torn-out sub-workspace Panel still belongs to. */
let projectB: string;
/** Somewhere outside every project — where a ROOTLESS sub-workspace Panel's file can live. */
let elsewhere: string;

function file(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, 'x', 'utf8');
  return path;
}

async function revealDocument(absPath: string): Promise<unknown> {
  const fn = invokes.get('throng:files:revealDocument');
  if (!fn) throw new Error('throng:files:revealDocument was never registered');
  return await fn(anyWindow, absPath);
}

/** Wire the registrar, telling it which paths are open in some Panel somewhere. */
function wire(openPaths: string[]): void {
  const service = new FilesService(new NodeFileSystem(), shell);
  service.setOpenDocumentCheck((abs) =>
    openPaths.some((p) => p.toLowerCase() === abs.toLowerCase()),
  );
  registerFilesIpc(service, watcher);
  // The main window's explorer points the process at project A, exactly as it does in the app.
  sends.get('throng:files:setRoot')?.(anyWindow, projectA);
}

beforeEach(() => {
  sends.clear();
  invokes.clear();
  revealed = [];
  openedFolders = [];
  dataDir = mkdtempSync(join(tmpdir(), 'throng-reveal-doc-'));
  projectA = join(dataDir, 'project-a');
  projectB = join(dataDir, 'project-b');
  elsewhere = join(dataDir, 'not-a-project');
  for (const dir of [projectA, projectB, elsewhere]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('#273 — a Panel reveals its own file, not the same relative path under another root', () => {
  it('a torn-out Panel reveals ITS project’s file while the main window is on another project', async () => {
    // The trap the old root-relative route fell into: the SAME relative path exists in both.
    const inB = file(projectB, 'notes.md');
    file(projectA, 'notes.md');
    wire([inB]);

    const result = await revealDocument(inB);

    expect(result).toEqual({ ok: true });
    expect(revealed).toEqual([inB]);
  });

  it('a ROOTLESS sub-workspace Panel reveals a file that is under no project at all', async () => {
    // The second symptom: `ownerRoot` is null here, so the old route produced no relative path and
    // the menu item did nothing. Silence, from a control that was shown and enabled.
    const loose = file(elsewhere, 'scratch.txt');
    wire([loose]);

    const result = await revealDocument(loose);

    expect(result).toEqual({ ok: true });
    expect(revealed).toEqual([loose]);
  });

  it('refuses a path no Panel is showing, however ordinary it looks', async () => {
    const notOpen = file(projectA, 'private.md');
    wire([]);

    const result = await revealDocument(notOpen);

    expect(result).toEqual({ error: 'Target is outside the project root.' });
    expect(revealed).toEqual([]);
    expect(openedFolders).toEqual([]);
  });

  it('refuses when nothing has wired the open-document check — a confinement check must not fail open', async () => {
    const inB = file(projectB, 'notes.md');
    const service = new FilesService(new NodeFileSystem(), shell);
    registerFilesIpc(service, watcher);

    const result = await revealDocument(inB);

    expect(result).toEqual({ error: 'Target is outside the project root.' });
    expect(revealed).toEqual([]);
  });

  it('opens a FOLDER’s contents rather than revealing it, as the relative route does', async () => {
    const folder = join(projectB, 'src');
    mkdirSync(folder, { recursive: true });
    wire([folder]);

    const result = await revealDocument(folder);

    expect(result).toEqual({ ok: true });
    expect(openedFolders).toEqual([folder]);
    expect(revealed).toEqual([]);
  });

  it('refuses an empty path without touching the filesystem', async () => {
    wire([]);
    expect(await revealDocument('')).toEqual({ error: 'Target is outside the project root.' });
  });
});

/**
 * 044 T061 / FR-033 — Open in OS Explorer on a STANDALONE preview.
 *
 * A standalone preview shows a file no editor has open (FR-025), so an open-document check that asks
 * only the editor registry refuses the one path the preview's own menu item names. The check `main.ts`
 * wires is `openInEditorOrPreview`, and it is exercised here over a real coordinator and a real
 * `PreviewService` rather than a list of paths, so the test fails if either half stops answering.
 */
describe('044 FR-033 — a path only a preview shows may be revealed', () => {
  async function wireWithPreview(): Promise<{ shown: string; nothing: string; dispose: () => void }> {
    const { EditorService } = await import('../../src/main/editor-service.js');
    const { EditorCoordinator } = await import('../../src/main/editor-coordinator.js');
    const { EditorRecovery } = await import('../../src/main/editor-recovery.js');
    const { PreviewService } = await import('../../src/main/preview-service.js');
    const { openInEditorOrPreview } = await import('../../src/main/open-document-check.js');
    const { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS } = await import('@throng/core');

    const nodeFs = new NodeFileSystem();
    const editorService = new EditorService(nodeFs, () => DEFAULT_APP_SETTINGS);
    const coordinator = new EditorCoordinator(editorService, new EditorRecovery(join(dataDir, 'recovery')), {
      relaySync: () => {},
      persistUndoHistory: () => false,
    });
    const previews = new PreviewService({
      documents: coordinator,
      reader: editorService,
      fs: nodeFs,
      fileWatcher: { watch: () => ({ dispose: () => {} }) },
      settings: () => DEFAULT_APP_SETTINGS,
      registry: SHIPPED_PREVIEW_PROVIDERS,
      projectRoot: async (id) => (id === 'B' ? projectB : undefined),
      push: {
        update: () => {},
        broadcastOpenChanged: () => {},
        broadcastPathChanged: () => {},
        sendFocus: () => {},
        sendPlace: () => true,
      },
      windows: { mainWindowId: () => null, raise: () => {} },
    });

    const shown = file(projectB, 'readme.md');
    const nothing = file(projectB, 'other.md');
    const attached = await previews.attach(2, { panelId: 'v1', projectId: 'B', filePath: shown });
    expect(attached.ok).toBe(true);
    // Nothing opened a document for it: the preview is the only thing showing it.
    expect(coordinator.isOpen(shown)).toBe(false);

    const service = new FilesService(new NodeFileSystem(), shell);
    service.setOpenDocumentCheck(openInEditorOrPreview(coordinator, previews));
    registerFilesIpc(service, watcher);
    return { shown, nothing, dispose: () => previews.destroyed('v1') };
  }

  it('reveals the file a standalone preview is showing', async () => {
    const { shown, dispose } = await wireWithPreview();

    expect(await revealDocument(shown)).toEqual({ ok: true });
    expect(revealed).toEqual([shown]);
    dispose();
  });

  it('still refuses a path that neither an editor nor a preview is showing', async () => {
    const { nothing, dispose } = await wireWithPreview();

    expect(await revealDocument(nothing)).toEqual({ error: 'Target is outside the project root.' });
    expect(revealed).toEqual([]);
    dispose();
  });
});
