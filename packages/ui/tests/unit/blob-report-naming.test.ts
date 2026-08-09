import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every E2E shard must write its blob report under a DISTINCT filename.
 *
 * ══ WHY THIS NEEDS A GUARD ══
 *
 * Playwright appends a shard suffix to the blob's name in `_defaultReportName()` only when
 * `config.shard` is set — and that is set only by its own `--shard`, which this repo deliberately
 * does not use (CI selects files from `shard-plan.json` by measured duration instead). So the
 * default is a flat `blob-report/report.zip` in EVERY shard job.
 *
 * The report job then downloads all three artifacts into one directory with `merge-multiple: true`.
 * Identical names in one directory overwrite each other, the merge reads a half-written zip, and the
 * merged HTML report — the thing you open to read a failure across shards — never gets built:
 *
 *     Error: not enough bytes in the stream. expected 4019954. got only 3740141
 *
 * Issue #216. It is a RACE, not a deterministic break, which is what makes it worth guarding: it
 * passed on two runs before it started failing, and nothing about the tests changed in between.
 *
 * ══ WHY A SOURCE GUARD ══
 *
 * Reproducing it needs three concurrent CI jobs and an artifact service; the property that actually
 * matters is static — the workflow passes a per-shard name, and the config reads it. Both halves are
 * asserted, because either one alone is silently useless: a config that reads an env var nobody sets
 * is the default again, and a workflow that sets a variable nobody reads is a no-op.
 */

const ROOT = new URL('../../../../', import.meta.url);
const CI = readFileSync(fileURLToPath(new URL('.github/workflows/ci.yml', ROOT)), 'utf8');
const PW = readFileSync(fileURLToPath(new URL('playwright.config.ts', ROOT)), 'utf8');

describe('E2E blob reports are named per shard (#216)', () => {
  it('the workflow passes a per-shard blob name to the shard run', () => {
    // The matrix value has to be IN the name; a constant would collide exactly as before.
    expect(CI).toMatch(/THRONG_E2E_BLOB_OUT:\s*report-\$\{\{\s*matrix\.shard\s*\}\}\.zip/);
  });

  it('the blob reporter reads that variable', () => {
    expect(PW).toMatch(/\[\s*'blob'\s*,\s*\{\s*fileName:\s*process\.env\.THRONG_E2E_BLOB_OUT/);
  });

  it('the blob reporter is never configured bare, which is what collided', () => {
    // `['blob']` with no options is the default name in every shard — the original defect.
    expect(PW).not.toMatch(/\[\s*'blob'\s*\]/);
  });

  it('still downloads the shards into one directory, which is why the names must differ', () => {
    /*
     * If this ever stops being true — each artifact landing in its own subdirectory instead — the
     * collision cannot happen and this guard is describing a hazard that no longer exists. Assert
     * it so the guard fails loudly and gets re-read, rather than quietly protecting nothing.
     */
    expect(CI).toMatch(/merge-multiple:\s*true/);
  });
});
