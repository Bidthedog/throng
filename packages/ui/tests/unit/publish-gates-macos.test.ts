import { describe, expect, it } from 'vitest';

import {
  buildArtifactVerdict,
  buildCoexistenceVerdict,
  COEXISTENCE_STEPS,
  combinationsOf,
  declareArtifactSet,
  GATEKEEPER_UNPROVEN_REASON,
} from '@throng/core';

// @ts-expect-error — plain-JS build/CI script, imported for its pure decision.
import { evaluateVerdictFiles } from '../../../../scripts/publish-gates.mjs';

/**
 * 070 FR-010 (and its clarification), T058 — a macOS verdict joins the publish gate as every other platform's does. A
 * step that FAILED on either supported release refuses the whole release; the Gatekeeper first launch, which a hosted
 * runner cannot click through, is unproven and lets it through, reported.
 *
 * Layer: unit — `evaluateVerdictFiles` is a pure function over the verdict files' text.
 */

const VERSION = '1.2.3';
const combinations = combinationsOf(declareArtifactSet(VERSION));
const SHA: Record<string, string> = Object.fromEntries(
  declareArtifactSet(VERSION).artifacts.map((a, i) => [a.role, String.fromCharCode(97 + i).repeat(64)]),
);

interface File {
  name: string;
  text: string;
}

/** A verdict as the harness writes it: every applicable step passed unless `results` says otherwise. */
function verdictFile(id: string, results: Record<string, boolean | 'unproven'> = {}): File {
  const combination = combinations.find((c) => c.id === id);
  if (!combination) throw new Error(`no combination ${id}`);
  const verdict = buildArtifactVerdict(
    combination,
    SHA[combination.role] ?? '',
    { ...Object.fromEntries(combination.applicableSteps.map((s) => [s, true])), ...results },
    { 'second-account': 'no interactive desktop', 'gatekeeper-first-launch': GATEKEEPER_UNPROVEN_REASON },
  );
  return { name: combination.verdictFile, text: JSON.stringify({ ...verdict, version: VERSION }) };
}

const coexistence: File = {
  name: 'verification-verdict-coexistence.json',
  text: JSON.stringify(buildCoexistenceVerdict(VERSION, [], Object.fromEntries(COEXISTENCE_STEPS.map((s) => [s, true])))),
};

/** Every combination's verdict, the macOS ones as a hosted Mac writes them: Gatekeeper unproven. */
const MAC_AS_RUN = { 'gatekeeper-first-launch': 'unproven' } as const;
const macIds = combinations.filter((c) => c.platform === 'darwin').map((c) => c.id);
const allFiles = (override: Record<string, Record<string, boolean | 'unproven'>> = {}): File[] => [
  ...combinations.map((c) => verdictFile(c.id, { ...(c.platform === 'darwin' ? MAC_AS_RUN : {}), ...override[c.id] })),
  coexistence,
];
const evaluate = (files: File[]) => evaluateVerdictFiles({ version: VERSION, files, actualSha256ByRole: SHA });

describe('publish-gates — the macOS verdicts (070 FR-010, T058)', () => {
  it('needs a verdict from each copy on each supported release', () => {
    expect(macIds).toEqual(['dmg-current', 'dmg-previous', 'macarchive-current', 'macarchive-previous']);
  });

  it('publishes with the Gatekeeper first launch unproven, and reports it for each copy and release', () => {
    const r = evaluate(allFiles());
    expect(r.refusal).toBeNull();
    expect(r.isVerified).toBe(true);
    expect(r.reportedGaps).toEqual(
      macIds.map((combination) => ({ combination, step: 'gatekeeper-first-launch', reason: GATEKEEPER_UNPROVEN_REASON })),
    );
  });

  it('refuses the whole release when a macOS step failed on the previous release only, naming it', () => {
    const r = evaluate(allFiles({ 'dmg-previous': { reattach: false } }));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toBe('dmg-previous: reattach failed');
  });

  it('refuses a failed Gatekeeper step: unproven is allowed, failed never is', () => {
    const r = evaluate(allFiles({ 'macarchive-current': { 'gatekeeper-first-launch': false } }));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toBe('macarchive-current: gatekeeper-first-launch failed');
  });

  it('refuses any other macOS step recorded unproven', () => {
    const r = evaluate(allFiles({ 'dmg-current': { 'cli-command': 'unproven' } }));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toBe('dmg-current: cli-command failed');
  });

  it('refuses when one release’s verdict is missing, naming that copy and release', () => {
    const r = evaluate(allFiles().filter((f) => f.name !== 'verification-verdict-macarchive-previous.json'));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toBe('macarchive-previous: no verification verdict');
  });

  it('refuses a macOS verdict recorded for other bytes', () => {
    const r = evaluateVerdictFiles({ version: VERSION, files: allFiles(), actualSha256ByRole: { ...SHA, dmg: 'f'.repeat(64) } });
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toMatch(/^dmg-current: the verdict was recorded for different bytes/);
  });
});
