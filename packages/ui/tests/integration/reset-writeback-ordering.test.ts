/**
 * A reset must never be undone by a bounds correction computed before it (032 FR-002a, 031 FR-013c).
 *
 * Layer: integration — the defect is in how the store's two real write paths are ordered against
 * each other; only the real store, the real service, the real watcher read and real files show a
 * reset landing and then being overwritten.
 *
 * ══ WHAT THE USER SEES ══
 *
 * `settings.json` holds a value outside its declared bounds — a hand edit, or a JSON-tab save. The
 * config watcher re-reads it, clamps the value, and writes the corrected document back (031 FR-013).
 * The user presses Reset to Defaults in the same moment. The reset lands — and is then replaced by
 * the correction, which was computed from the document as it stood BEFORE the reset. The file ends
 * up holding the user's old settings, clamped, and the reset is gone with no notice.
 *
 * ══ WHY THE TWO COULD INTERLEAVE ══
 *
 * The write-back is compare-and-swap on the store's per-path chain: it re-reads the file, gives up if
 * the bytes moved, and otherwise commits. The resets run under the document lock (032 FR-002a) but
 * wrote through `writeFilesAtomic`, which never joined that chain, and the write-back never takes the
 * document lock. So nothing ordered the reset against the gap between the write-back's compare and
 * its rename — and a rename riding out a momentary hold (032 FR-009) keeps that gap open for up to a
 * second.
 *
 * ══ HOW THE ORDER IS FORCED ══
 *
 * The write-back's rename onto `settings.json` is parked at a gate, after its compare has passed.
 * The reset is issued while it is parked, and given a bounded chance to finish before the gate opens
 * (250 ms: unordered, it needs only a handful of local file operations; ordered, it cannot finish at
 * all until the gate opens, so the bound only decides how long the ordered case waits). Unordered,
 * the reset finishes and the parked correction then lands on top of it. Ordered, it waits for the
 * correction and lands last.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigOnce } from '../../src/main/config-watcher.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/** The gate the write-back's rename is parked at. `armedFor` is the destination being watched. */
const gate = vi.hoisted(() => ({
  armedFor: null as string | null,
  parked: null as null | (() => void),
  release: null as null | (() => void),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { resolve: resolvePath } = await import('node:path');
  const rename = async (from: string, to: string): Promise<void> => {
    // Only the ordinary write's `.tmp` staging — the write-back's commit. The reset's `.staging`
    // rename is never parked; it is the write being ordered against this one.
    if (
      gate.armedFor !== null &&
      resolvePath(String(to)) === gate.armedFor &&
      /\.\d+\.tmp$/.test(String(from))
    ) {
      gate.armedFor = null;
      await new Promise<void>((open) => {
        gate.release = open;
        gate.parked?.();
      });
    }
    return actual.rename(from, to);
  };
  return { ...actual, rename, default: { ...actual, rename } };
});

const SHIPPED = buildShippedDefaults();

/** `panes.projects.maxWidth` clamps to this (settings-bounds-writeback.test.ts W1). */
const CLAMPED_MAX_WIDTH = 1200;

const tempDirs: string[] = [];
afterEach(() => {
  gate.armedFor = null;
  gate.release?.();
  gate.parked = null;
  gate.release = null;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function maxWidthOnDisk(settingsPath: string): unknown {
  return (JSON.parse(readFileSync(settingsPath, 'utf8')) as { panes?: { projects?: { maxWidth?: unknown } } })
    .panes?.projects?.maxWidth;
}

describe('a reset racing the watcher’s bounds correction (032 FR-002a, 031 FR-013c)', () => {
  it('Reset to Defaults lands last: a correction computed before it never overwrites it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-reset-writeback-'));
    tempDirs.push(root);
    const store = new FileConfigStore(root);
    const service = new ShippedDefaultsService(store, SHIPPED);
    expect((await service.seed()).ok).toBe(true);
    const settingsPath = store.pathOf({ kind: 'settings' });

    // The shipped value must differ from the clamp, or "the reset survived" and "the correction
    // won" would read the same.
    const shippedMaxWidth = SHIPPED.settings.panes.projects.maxWidth;
    expect(shippedMaxWidth).not.toBe(CLAMPED_MAX_WIDTH);

    // A hand edit takes the value out of range.
    const edited = structuredClone(SHIPPED.settings) as unknown as { panes: { projects: { maxWidth: number } } };
    edited.panes.projects.maxWidth = 99_999;
    writeFileSync(settingsPath, FileConfigStore.serialize(edited), 'utf8');

    // The watcher's read finds it and clamps it; the write-back's compare passes, then its rename
    // is parked.
    const parked = new Promise<void>((resolveParked) => {
      gate.parked = resolveParked;
    });
    gate.armedFor = resolve(settingsPath);
    const watcherRead = readConfigOnce(store);
    await parked;

    // The user presses Reset to Defaults while the correction is in flight.
    const reset = service.resetSettings();
    await Promise.race([reset, new Promise((r) => setTimeout(r, 250))]);

    gate.release?.();
    const [resetResult] = await Promise.all([reset, watcherRead]);

    expect(resetResult).toEqual({ ok: true });
    // The reset was the user's last word. The file must hold the shipped value, not the clamp of
    // the document the reset replaced.
    expect(maxWidthOnDisk(settingsPath)).toBe(shippedMaxWidth);
  });
});
