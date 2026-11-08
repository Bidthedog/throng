/**
 * The verification probe's one JSON line survives a code-page round trip.
 *
 * `scripts/daemon-probe.mjs` runs as a second Windows account under PowerShell 5.1, whose
 * `Get-Content -Raw | Write-Output` re-reads its stdout in the ANSI code page and writes it in the OEM
 * one. The line embeds the daemon's own start-up output, and an em dash there (066's "expected — …"
 * log records) came back with its last byte as a bare `"`, so the harness's JSON.parse failed and every
 * second-account check read an empty result (release.yml run 42433251187). ASCII passes through every
 * code page unchanged, so the line must be ASCII.
 */
import { describe, expect, it } from 'vitest';
import { asciiJson } from '../../../../scripts/daemon-probe.mjs';

describe('the daemon probe result line', () => {
  const result = {
    ok: true,
    pid: 2368,
    preflight: { daemon: { out: 'composition-root: read terminals.commandPollMs: expected — settings.json may not exist yet', err: 'naïve “quotes” 🚀' } },
  };

  it('is pure ASCII, whatever the daemon printed', () => {
    expect(asciiJson(result)).toMatch(/^[\x20-\x7e]*$/);
  });

  it('parses back to exactly the result', () => {
    expect(JSON.parse(asciiJson(result))).toEqual(result);
  });

  it('survives every non-ASCII byte being replaced, as a lossy code page would', () => {
    const lossy = Buffer.from(asciiJson(result), 'utf8').toString('latin1').replace(/[^\x20-\x7e]/g, '"');
    expect(JSON.parse(lossy)).toEqual(result);
  });
});
