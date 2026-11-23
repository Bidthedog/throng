/**
 * #681 — the project list's **Open in OS Explorer** opens a project's ROOT folder, for any project,
 * loaded or not.
 *
 * The File Explorer's `files.reveal('')` resolves against the one root the main window's explorer last
 * set — the ACTIVE project's. Right-clicking any OTHER row in the project list would therefore open
 * the wrong folder. `revealProjectRoot` takes the project's ID and looks the root up through an
 * injected resolver (main wires it to its own `projects.list` view), so the renderer never names a path
 * and nothing outside a registered project root can be reached through it.
 *
 * Layer: integration, over a real `NodeFileSystem` and real temp directories, driving the real IPC
 * registrar through a faked `ipcMain` — the same harness as `files-reveal-document.integration.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sends = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const invokes = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => sends.set(channel, fn),
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => invokes.set(channel, fn),
  },
}));

const { NodeFileSystem } = await import('../../src/main/node-file-system.js');
const { FilesService } = await import('../../src/main/files-service.js');
const { registerFilesIpc } = await import('../../src/main/files-ipc.js');

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
let projectA: string;
let projectB: string;

async function revealProjectRoot(projectId: unknown): Promise<unknown> {
  const fn = invokes.get('throng:files:revealProjectRoot');
  if (!fn) throw new Error('throng:files:revealProjectRoot was never registered');
  return await fn(anyWindow, projectId);
}

/** Wire the registrar with a resolver that knows projects A and B; the main window is on A. */
function wire(roots: Record<string, string> = { A: projectA, B: projectB }): void {
  const service = new FilesService(new NodeFileSystem(), shell);
  service.setProjectRootResolver(async (id) => roots[id] ?? null);
  registerFilesIpc(service, watcher);
  sends.get('throng:files:setRoot')?.(anyWindow, projectA);
}

beforeEach(() => {
  sends.clear();
  invokes.clear();
  revealed = [];
  openedFolders = [];
  dataDir = mkdtempSync(join(tmpdir(), 'throng-reveal-root-'));
  projectA = join(dataDir, 'project-a');
  projectB = join(dataDir, 'project-b');
  for (const dir of [projectA, projectB]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('#681 — Open in OS Explorer on a project row opens THAT project’s root', () => {
  it('opens a project’s root that is not the active one', async () => {
    wire();

    expect(await revealProjectRoot('B')).toEqual({ ok: true });
    expect(openedFolders).toEqual([projectB]);
    expect(revealed).toEqual([]);
  });

  it('opens the active project’s root too', async () => {
    wire();

    expect(await revealProjectRoot('A')).toEqual({ ok: true });
    expect(openedFolders).toEqual([projectA]);
  });

  it('a root folder that no longer exists fails through the reveal failure path, opening nothing', async () => {
    wire();
    rmSync(projectB, { recursive: true, force: true });

    const result = (await revealProjectRoot('B')) as { error?: string };

    expect(typeof result.error).toBe('string');
    expect(openedFolders).toEqual([]);
  });

  it('refuses an unknown project id, and a non-string one, without touching the shell', async () => {
    wire();

    expect(await revealProjectRoot('nope')).toEqual({ error: 'Unknown project.' });
    expect(await revealProjectRoot(42)).toEqual({ error: 'Unknown project.' });
    expect(openedFolders).toEqual([]);
  });

  it('refuses when nothing has wired the resolver — the lookup must not fail open', async () => {
    const service = new FilesService(new NodeFileSystem(), shell);
    registerFilesIpc(service, watcher);

    expect(await revealProjectRoot('B')).toEqual({ error: 'Unknown project.' });
    expect(openedFolders).toEqual([]);
  });
});
