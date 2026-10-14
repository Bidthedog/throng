/**
 * 054 — `PreviewService.readEmbeds`: the text of the Mermaid files a Markdown preview embeds
 * (`![[x.mmd]]`, `![alt](x.mmd)`), resolved from the run's OWN document and project and confined to it
 * like a local image (Principle I).
 *
 * Layer: integration — resolution against real folders, the real-path containment check (a junction out
 * of the project) and the real reader are properties of the disk; the reference test itself is core unit.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

const fs = new NodeFileSystem(async () => {});
const VIEWER = 7;
const FLOW = 'graph TD\n  A --> B\n';

let root: string;
let outside: string;
let recoveryDir: string;
let previews: PreviewService;

async function file(relPath: string, text: string, under = root): Promise<string> {
  const path = join(under, relPath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-embeds-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-embeds-out-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-embeds-rec-'));
  const relay = lateListener();
  const service = new EditorService(fs, () => liveSettings().current);
  const coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: liveSettings().get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push: recordingPush(),
    windows: recordingWindows(),
  });
  relay.bind(previews);
  const doc = await file('docs/index.md', '# Doc\n');
  const res = await previews.attach(VIEWER, { panelId: 'v1', projectId: 'P', filePath: doc });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
});

afterEach(async () => {
  previews.destroyed('v1');
  for (const dir of [root, outside, recoveryDir]) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('readEmbeds', () => {
  it('reads a sibling, a nested and a project-rooted Mermaid file, in the order asked', async () => {
    await file('docs/flow.mmd', FLOW);
    await file('docs/sub/seq.mermaid', 'sequenceDiagram\n');
    await file('top.mmd', 'graph LR\n');
    const { results } = await previews.readEmbeds('v1', ['flow.mmd', 'sub/seq.mermaid', '/top.mmd']);
    expect(results).toEqual([
      { ref: 'flow.mmd', ok: true, text: FLOW },
      { ref: 'sub/seq.mermaid', ok: true, text: 'sequenceDiagram\n' },
      { ref: '/top.mmd', ok: true, text: 'graph LR\n' },
    ]);
  });

  it('reads a name written with an encoded space', async () => {
    await file('docs/my flow.mmd', FLOW);
    const { results } = await previews.readEmbeds('v1', ['my%20flow.mmd']);
    expect(results[0]).toEqual({ ref: 'my%20flow.mmd', ok: true, text: FLOW });
  });

  it('refuses a missing file, a non-Mermaid file and a path out of the project', async () => {
    await file('docs/notes.md', '# n\n');
    const { results } = await previews.readEmbeds('v1', ['gone.mmd', 'notes.md', '../../escape.mmd']);
    expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['missing', 'unsupported', 'outside']);
  });

  it('refuses a file reached through a junction that leads out of the project', async () => {
    await file('real.mmd', FLOW, outside);
    try {
      await symlink(outside, join(root, 'docs', 'link'), 'junction');
    } catch {
      return; // junctions unavailable: nothing to prove here
    }
    const { results } = await previews.readEmbeds('v1', ['link/real.mmd']);
    expect(results[0]).toEqual({ ref: 'link/real.mmd', ok: false, reason: 'outside' });
  });

  it('answers every reference missing for a panel with no run', async () => {
    const { results } = await previews.readEmbeds('nope', ['flow.mmd']);
    expect(results).toEqual([{ ref: 'flow.mmd', ok: false, reason: 'missing' }]);
  });
});
