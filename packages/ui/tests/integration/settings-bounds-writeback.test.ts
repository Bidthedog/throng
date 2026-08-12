/**
 * 031 US2 (#227) — write-back: the file ends up SAYING what the app is using.
 *
 * The guard itself is pure and unit-tested. What these tests own is the half that touches disk and
 * that no unit test can reach: a corrected document is written back (W1), a clean one is not
 * (W2), the sequence settles after exactly one write (W5), a write that fails still starts the app
 * (W6), a correction and a user save cannot lose each other (W4), a hand-edit made while the app
 * runs is corrected AND written back on reload (W7), a reset causes no churn (G13), and the daemon
 * corrects in memory while never touching the file (W3).
 *
 * The distinction W2/W5/G13 all turn on is CHURN. A guard that rewrote settings.json on every read
 * would be indistinguishable from a bug: the file's timestamp would move for no reason, every
 * config watcher in every window would fire, and a user comparing their settings across machines
 * would see a diff that nobody made. So "was it written" is asserted as bytes AND mtime, not as
 * "did the value come back right".
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  buildShippedDefaults,
  parseSettingsGuarded,
  type AppSettings,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigPayload } from '../../src/main/config-watcher.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-bounds-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    // A W6 test leaves settings.json read-only; put it back or Windows refuses the delete.
    try {
      chmodSync(join(dir, 'settings.json'), 0o666);
    } catch {
      /* not every root has one */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A COMPLETE settings document with one leaf changed — what a real settings.json looks like. */
function docWith(changes: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const parts = path.split('.');
    const last = parts.pop()!;
    const parent = parts.reduce<Record<string, unknown>>(
      (o, k) => o[k] as Record<string, unknown>,
      doc,
    );
    parent[last] = value;
  }
  return doc;
}

interface Seeded {
  root: string;
  store: FileConfigStore;
  path: string;
}

function seed(doc: unknown): Seeded {
  const root = freshRoot();
  const store = new FileConfigStore(root);
  const path = store.pathOf({ kind: 'settings' });
  writeFileSync(path, FileConfigStore.serialize(doc), 'utf8');
  return { root, store, path };
}

function readSettings(store: FileConfigStore): Promise<AppSettings> {
  // `parseSettingsGuarded` is the REPORTING validator: it returns the value AND whether anything
  // moved, which is the whole mechanism by which the store knows a write-back is owed.
  return store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseSettingsGuarded);
}

function onDisk(path: string): Record<string, never> & AppSettings {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, never> & AppSettings;
}

/** Count write attempts. Every write — user save or write-back — serialises exactly once. */
function countWrites(): { calls: () => number } {
  const spy = vi.spyOn(FileConfigStore, 'serialize');
  return { calls: () => spy.mock.calls.length };
}

describe('W1 — a corrected document is written back (FR-013)', () => {
  it('loads the value at its bound AND leaves the file saying so', async () => {
    const { store, path } = seed(
      docWith({ 'panes.projects.maxWidth': 99_999, 'diagnostics.keepFiles': 0 }),
    );

    const settings = await readSettings(store);

    expect(settings.panes.projects.maxWidth).toBe(1200);
    expect(settings.diagnostics.keepFiles).toBe(1);
    // The point of FR-013: the file is no longer lying about what is in use.
    expect(onDisk(path).panes.projects.maxWidth).toBe(1200);
    expect(onDisk(path).diagnostics.keepFiles).toBe(1);
  });

  it('writes back a fault that is INSIDE a table, not only a top-level leaf (G12)', async () => {
    const { store, path } = seed(
      docWith({
        'editor.indentByLanguage': { python: { style: 'spaces', indentWidth: 500, tabWidth: 4 } },
      }),
    );

    const settings = await readSettings(store);

    expect(settings.editor.indentByLanguage.python?.indentWidth).toBe(16);
    expect(onDisk(path).editor.indentByLanguage.python?.indentWidth).toBe(16);
  });
});

describe('W2 — a clean document is NOT rewritten (FR-014)', () => {
  it('leaves the bytes and the modification time exactly as they were', async () => {
    const { store, path } = seed(docWith());
    const before = { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };
    const writes = countWrites();

    const settings = await readSettings(store);

    expect(settings.panes.projects.maxWidth).toBe(DEFAULT_APP_SETTINGS.panes.projects.maxWidth);
    expect(readFileSync(path, 'utf8')).toBe(before.bytes);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
    expect(writes.calls(), 'a clean start must not write anything at all').toBe(0);
  });
});

describe('W5 — the sequence settles after ONE write (FR-013d)', () => {
  it('re-reading a written-back document corrects nothing and writes nothing', async () => {
    const { store, path } = seed(docWith({ 'behaviour.submenuHoverMs': 99_999 }));
    const writes = countWrites();

    await readSettings(store);
    expect(writes.calls(), 'the correction is one write, not a cascade').toBe(1);
    const settled = { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };

    // Three more reads: if the guard oscillated (correcting what it had just written) this is
    // where it would show, and it would show as an ever-climbing write count.
    for (let i = 0; i < 3; i += 1) {
      const settings = await readSettings(store);
      expect(settings.behaviour.submenuHoverMs).toBe(2000);
    }

    expect(writes.calls()).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe(settled.bytes);
    expect(statSync(path).mtimeMs).toBe(settled.mtime);
    expect(parseSettingsGuarded(onDisk(path)).corrected).toBe(false);
  });
});

describe('W6 — a failed write-back still starts the app (FR-018)', () => {
  it('returns the corrected values, leaves the file alone, and does not retry in a loop', async () => {
    const { store, path } = seed(docWith({ 'panes.fileExplorer.maxWidth': 99_999 }));
    const original = readFileSync(path, 'utf8');
    chmodSync(path, 0o444); // read-only: the atomic replace cannot land
    const writes = countWrites();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const settings = await readSettings(store);

    // The application starts, and it runs on the corrected value — that is the requirement.
    expect(settings.panes.fileExplorer.maxWidth).toBe(1200);
    expect(readFileSync(path, 'utf8')).toBe(original); // the user's file is untouched
    expect(writes.calls(), 'one attempt, then it gives up and reports').toBe(1);
    expect(errors).toHaveBeenCalled();

    // …and nothing is still trying in the background.
    const after = writes.calls();
    await new Promise((r) => setTimeout(r, 250));
    expect(writes.calls()).toBe(after);
  });
});

describe('W4 — a correction and a user save cannot lose each other (FR-013c)', () => {
  it('ends with the user’s save, carrying the correction, and never a torn file', async () => {
    // The file holds an out-of-range width. The renderer is showing the CORRECTED settings (that
    // is what main broadcast to it), so the save it sends carries the corrected width plus the one
    // thing the user actually changed.
    const { store, path } = seed(docWith({ 'panes.projects.maxWidth': 99_999 }));
    const userSave = docWith({
      'panes.projects.maxWidth': 1200,
      'behaviour.submenuHoverMs': 250,
    });

    // Issued together, deliberately unordered — the two writers racing is the scenario.
    const [settings, outcome] = await Promise.all([
      readSettings(store),
      store.write({ kind: 'settings' }, userSave),
    ]);

    expect(outcome.ok).toBe(true);
    expect(settings.panes.projects.maxWidth).toBe(1200);

    const file = onDisk(path); // parses at all ⇒ the two writes did not interleave
    expect(file.behaviour.submenuHoverMs, 'the user’s edit was lost').toBe(250);
    expect(file.panes.projects.maxWidth, 'the correction was lost').toBe(1200);
    expect(parseSettingsGuarded(file).corrected).toBe(false);
  });
});

describe('W7 — a hand-edit made while the app is running (FR-013a)', () => {
  it('is written back through the REAL reload path, not just a direct store.read', async () => {
    // `readConfigPayload` is what the config watcher calls on every file change. If it passed a
    // validator that could not report a correction, everything above would still pass and the
    // shipped application would still never write anything back — the wiring is the requirement.
    const { store, path } = seed(docWith({ 'panes.projects.maxWidth': 99_999 }));

    const payload = await readConfigPayload(store);

    expect(payload.settings.panes.projects.maxWidth).toBe(1200);
    expect(onDisk(path).panes.projects.maxWidth).toBe(1200);
  });

  it('is corrected AND written back on the reload, not only at startup', async () => {
    const { store, path } = seed(docWith());
    // Serialised BEFORE the spy goes on: the fixture's own write is not a write-back, and
    // counting it would make the assertion below pass for the wrong reason.
    const handEdited = FileConfigStore.serialize(docWith({ 'terminals.commandPollMs': 10 }));
    const writes = countWrites();

    // Startup read: clean, so nothing is written.
    await readSettings(store);
    expect(writes.calls()).toBe(0);

    // The user hand-edits the file with the app running; the config watcher re-reads it.
    writeFileSync(path, handEdited, 'utf8');

    const reloaded = await readSettings(store);

    expect(reloaded.terminals.commandPollMs).toBe(250);
    expect(onDisk(path).terminals.commandPollMs).toBe(250);
    expect(writes.calls(), 'the reload owes exactly one write-back').toBe(1);
  });
});

describe('G13 — resetting a setting to its shipped default causes no churn (FR-017)', () => {
  it('applies the reset and the next guarded read finds nothing to correct', async () => {
    const { store, path } = seed(docWith({ 'panes.projects.maxWidth': 900 }));
    const service = new ShippedDefaultsService(store, buildShippedDefaults());

    const reset = await service.resetSetting('panes.projects.maxWidth');
    expect(reset.ok).toBe(true);
    expect(onDisk(path).panes.projects.maxWidth).toBe(
      DEFAULT_APP_SETTINGS.panes.projects.maxWidth,
    );

    // A shipped default is inside its own bound BY DEFINITION, so the guard is inert on this path.
    const settled = { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };
    const writes = countWrites();
    const settings = await readSettings(store);

    expect(settings.panes.projects.maxWidth).toBe(DEFAULT_APP_SETTINGS.panes.projects.maxWidth);
    expect(writes.calls(), 'a reset must not provoke a write-back').toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(settled.bytes);
    expect(statSync(path).mtimeMs).toBe(settled.mtime);
  });

  it('resets EVERY setting to shipped values without the guard finding a single fault', async () => {
    // The converse of G13, discovered rather than sampled: if any shipped default sat outside its
    // own declared bound, a full reset would immediately be "corrected" and rewritten.
    const { store, path } = seed(docWith({ 'behaviour.tabHoverActivateMs': 4999 }));
    const service = new ShippedDefaultsService(store, buildShippedDefaults());

    expect((await service.resetSettings()).ok).toBe(true);

    const outcome = parseSettingsGuarded(onDisk(path));
    expect(outcome.corrections, 'a shipped default is outside its own declared bound').toEqual([]);
  });
});

describe('W3 — the daemon corrects in memory and never writes (FR-013b)', () => {
  it('reads the same file, resolves the same corrected value, and leaves the file untouched', async () => {
    // The daemon has no config store: it reads settings.json synchronously for the one value it
    // needs. It must see the same correction UI-main does — and it must be the only reader that
    // cannot write, because two processes writing one file is how a config file gets truncated.
    const { store, path } = seed(docWith({ 'terminals.commandPollMs': 99_999 }));
    const before = { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };

    const daemonView = parseSettingsGuarded(JSON.parse(readFileSync(path, 'utf8')) as unknown);

    expect(daemonView.value.terminals.commandPollMs).toBe(5000);
    expect(daemonView.corrected).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before.bytes);
    expect(statSync(path).mtimeMs).toBe(before.mtime);

    // …and UI-main, reading the very same file, is the one that writes it back.
    await readSettings(store);
    expect(onDisk(path).terminals.commandPollMs).toBe(5000);
  });
});
