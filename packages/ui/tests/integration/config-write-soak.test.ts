/**
 * 032 T009 — SC-004: no settings change is lost across 1,000 interleaved writes from two
 * concurrent writers.
 *
 * ══ WHY A SOAK, AND NOT AN INSPECTION ══
 *
 * G12 says every main-process writer shares one serialisation point, and the contract is explicit
 * that "the test that proves this is a soak, not an inspection". A reviewer reading the code can
 * confirm the writers they LOOKED AT take the lock — which is exactly the check that missed four
 * writers across three rounds of this spec. A soak asks the only question that matters: after a
 * thousand concurrent read-modify-write cycles, is every single change still there?
 *
 * The two writers deliberately own DISJOINT key spaces. Any missing key is therefore an
 * interleave — read-A, read-B, write-A, write-B — and not a legitimate last-write-wins outcome,
 * so the failure is unambiguous rather than a judgement call.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

/** 500 writes each, from two concurrent writers (SC-004). */
const WRITES_PER_WRITER = 500;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('1,000 interleaved writes', () => {
  it('loses nothing (SC-004)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-write-soak-'));
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'settings.json'), JSON.stringify(DEFAULT_APP_SETTINGS), 'utf8');
    const store = new FileConfigStore(root);

    /*
     * REAL SETTINGS KEYS, not synthetic ones.
     *
     * Every settings write normalises through the parse and drops keys the schema does not model
     * (007 FR-023), so a soak over `a0`…`a499` would write a thousand keys and find none of them —
     * proving nothing about serialisation and everything about the parse.
     *
     * `editor.languageByExtension` is a MAP-shaped setting — a `Record<string, string>` of user
     * extension→language mappings, shipped EMPTY and open to any key. That makes it the one place a
     * thousand distinct, real settings paths exist, so the soak runs through exactly the code the
     * product runs.
     */
    const path = (prefix: string, i: number): string[] => [
      'editor',
      'languageByExtension',
      `.${prefix}${i}`,
    ];

    /**
     * One writer's stream of key-scoped changes, issued as fast as the event loop allows.
     *
     * Not awaited one at a time — that would serialise them at the CALL SITE and test nothing. Each
     * writer fires its whole batch and the two batches race, which is the condition the lock exists
     * for.
     */
    const writer = (prefix: string): Promise<unknown>[] =>
      Array.from({ length: WRITES_PER_WRITER }, (_, i) =>
        writeConfigPatch(store, { kind: 'settings' }, [
          { path: path(prefix, i), value: `${prefix}-${i}` },
        ]),
      );

    const results = await Promise.all([...writer('a'), ...writer('b')]);

    // Every write reported success. This assertion is here because the DEFECT also reports success:
    // a lost change is not an error, which is why nobody saw it for two releases.
    expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);

    const after = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as {
      editor: { languageByExtension: Record<string, string> };
    };
    const table = after.editor.languageByExtension;

    const missing: string[] = [];
    for (let i = 0; i < WRITES_PER_WRITER; i += 1) {
      if (table[`.a${i}`] !== `a-${i}`) missing.push(`.a${i}`);
      if (table[`.b${i}`] !== `b-${i}`) missing.push(`.b${i}`);
    }

    // Reported as a COUNT with examples rather than a bare boolean: without the lock this fails with
    // hundreds missing, and "1000 expected, 3 lost" is a very different diagnosis from
    // "1000 expected, 900 lost".
    expect(
      { lost: missing.length, examples: missing.slice(0, 5) },
      `settings.json should carry all ${WRITES_PER_WRITER * 2} changes`,
    ).toEqual({ lost: 0, examples: [] });
  });
});
