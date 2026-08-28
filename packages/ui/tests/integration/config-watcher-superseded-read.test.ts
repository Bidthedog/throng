import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  type Disposable,
  type IFileWatcher,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import {
  isSupersededPayload,
  readConfigOnce,
  startConfigWatcher,
  type ConfigPayload,
} from '../../src/main/config-watcher.js';

/**
 * #341 / #333 — a watcher read that a write overtook must never be broadcast.
 *
 * ══ THE DEFECT, AS MEASURED ══
 *
 * A watcher read is not instantaneous. It opens settings, the active theme and keybindings in turn,
 * and 032 FR-008 makes it retry for up to ~100 ms when it catches a partial write. A config write
 * can commit inside that window, which leaves the read holding a document the file has stopped
 * containing — and the broadcast then arrives at the renderer AFTER the renderer has adopted the
 * write that superseded it.
 *
 * The renderer cannot defend itself against this, and that is why the guard is here rather than
 * there: `onChange` replaces the whole state because a broadcast is supposed to be the truth, and
 * nothing in the payload ever said which moment it was the truth AT.
 *
 * The consequence is worse than a stale render, because the preferences tabs compose their next
 * edit from what they were last told. Measured on an idle machine, one run in seven of
 * `preferences-reset.e2e.ts` lost a chord this way: remove a chord from `zoom.in` (file correct),
 * the stale broadcast reverts the renderer, remove a chord from `zoom.out`, and THAT write — a
 * whole document composed from the reverted copy — puts `zoom.in` back to its shipped value on
 * disk. The Reset control then correctly reports the row as un-overridden, so the click the test
 * makes next can never become actionable.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-superseded-read-'));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, 'settings.json'),
    `${JSON.stringify(DEFAULT_APP_SETTINGS, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'keybindings.json'),
    `${JSON.stringify(DEFAULT_KEYBINDINGS, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A store whose reads can be held open, so a write can be made to land mid-read on purpose. */
class GatedStore extends FileConfigStore {
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;

  /** Hold the NEXT read open until {@link openGate} is called. */
  closeGate(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  openGate(): void {
    this.release?.();
    this.gate = null;
    this.release = null;
  }

  override async readRaw(doc: Parameters<FileConfigStore['readRaw']>[0]): Promise<string> {
    if (this.gate) await this.gate;
    return super.readRaw(doc);
  }
}

function fakeWatcher(): { watcher: IFileWatcher; fire: () => void } {
  let cb: ((path: string) => void) | null = null;
  return {
    watcher: {
      watch(_dir: string, onChange: (path: string) => void): Disposable {
        cb = onChange;
        return { dispose: () => (cb = null) };
      },
    },
    fire: () => cb?.('keybindings.json'),
  };
}

function editedKeybindings(): string {
  const shipped = DEFAULT_KEYBINDINGS.bindings['zoom.in'];
  return `${JSON.stringify(
    {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': shipped.slice(1) },
    },
    null,
    2,
  )}\n`;
}

describe('a read the write path overtook (#341, #333)', () => {
  it('is recognised as superseded', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);

    const { payload } = await readConfigOnce(store);
    expect(isSupersededPayload(store, payload)).toBe(false);

    // Any committed write moves the store past the moment this payload describes.
    await store.writeFilesAtomic([
      { path: join(root, 'keybindings.json'), content: editedKeybindings() },
    ]);

    expect(isSupersededPayload(store, payload)).toBe(true);

    // A read taken afterwards is current again — the guard suppresses staleness, not the channel.
    const { payload: fresh } = await readConfigOnce(store);
    expect(isSupersededPayload(store, fresh)).toBe(false);
  });

  it('is not broadcast, so the renderer is never told the file says something it stopped saying', async () => {
    const root = freshRoot();
    const store = new GatedStore(root);
    const { watcher, fire } = fakeWatcher();
    const sent: ConfigPayload[] = [];

    startConfigWatcher({
      store,
      watcher,
      config: { configRoot: root } as never,
      broadcast: (p) => sent.push(p),
      policy: { attempts: 1, intervalMs: 0 },
    });

    // A read begins against the pristine file and is held open …
    store.closeGate();
    fire();
    await Promise.resolve();

    // … while the user's edit commits underneath it.
    await store.writeFilesAtomic([
      { path: join(root, 'keybindings.json'), content: editedKeybindings() },
    ]);

    store.openGate();
    await new Promise((r) => setTimeout(r, 50));

    // The read it was holding described the pre-edit file. Broadcasting it would revert every
    // window to a document the file no longer contains.
    expect(sent).toHaveLength(0);

    // The write's own watcher event carries the current document, which is what makes dropping the
    // stale one free rather than lossy.
    fire();
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(1);
    expect(sent[0].keybindings.bindings['zoom.in']).toEqual(
      DEFAULT_KEYBINDINGS.bindings['zoom.in'].slice(1),
    );
    // And the file was never touched by any of this.
    expect(
      (JSON.parse(readFileSync(join(root, 'keybindings.json'), 'utf8')) as typeof DEFAULT_KEYBINDINGS)
        .bindings['zoom.in'],
    ).toEqual(DEFAULT_KEYBINDINGS.bindings['zoom.in'].slice(1));
  });
});
