import { describe, expect, it } from 'vitest';

import {
  buildArtifactVerdict,
  buildCoexistenceVerdict,
  COEXISTENCE_STEPS,
  combinationsOf,
  declareArtifactSet,
} from '@throng/core';

// @ts-expect-error — plain-JS build/CI script, imported for its pure decision.
import { evaluateVerdictFiles } from '../../../../scripts/publish-gates.mjs';
// @ts-expect-error — plain-JS build/CI script, imported for its pure rendering.
import { renderGapsSummary } from '../../../../scripts/verification-summary.mjs';

/**
 * 058 FR-030 — `publish-gates.mjs` reads one verdict file per verification combination plus the
 * coexistence verdict, and refuses naming the combination that did not pass.
 * `evaluateVerdictFiles` is the pure part: it takes the files' names and text, and the actual
 * checksums of the artifacts, and says whether publication may go ahead.
 *
 * Layer: unit — a pure function over strings; the file reading around it is a thin shell.
 */

const VERSION = '1.2.3';
const set = declareArtifactSet(VERSION);
const combinations = combinationsOf(set);
const SHA: Record<string, string> = {
  setup: 'a'.repeat(64),
  msi: 'b'.repeat(64),
  portable: 'c'.repeat(64),
  archive: 'd'.repeat(64),
};

interface File {
  name: string;
  text: string;
}

function verdictFile(id: string, results: Record<string, boolean | 'unproven'> = {}): File {
  const combination = combinations.find((c) => c.id === id)!;
  const verdict = buildArtifactVerdict(
    combination,
    SHA[combination.role],
    { ...Object.fromEntries(combination.applicableSteps.map((s) => [s, true])), ...results },
    { 'second-account': 'no interactive desktop for a second account' },
  );
  return { name: combination.verdictFile, text: JSON.stringify({ ...verdict, version: VERSION }) };
}

function coexistenceFile(failing?: string): File {
  const verdict = buildCoexistenceVerdict(
    VERSION,
    [],
    Object.fromEntries(COEXISTENCE_STEPS.map((s) => [s, s !== failing])),
  );
  return { name: 'verification-verdict-coexistence.json', text: JSON.stringify(verdict) };
}

const allFiles = (): File[] => [...combinations.map((c) => verdictFile(c.id)), coexistenceFile()];
const evaluate = (files: File[]) => evaluateVerdictFiles({ version: VERSION, files, actualSha256ByRole: SHA });

describe('the verification-gaps summary (058 SC-008)', () => {
  it('lists every unproven step by combination, step and reason', () => {
    const md = renderGapsSummary([
      { combination: 'setup-machine', step: 'second-account', reason: 'no desktop' },
      { combination: 'msi-machine', step: 'second-account', reason: 'no desktop | at all' },
    ]);
    expect(md).toContain('`setup-machine`');
    expect(md).toContain('`msi-machine`');
    expect(md).toContain('no desktop \\| at all');
    expect(md).toMatch(/2 steps/);
  });

  it('says so when there are none, rather than saying nothing', () => {
    expect(renderGapsSummary([])).toMatch(/None/);
  });
});

describe('publish-gates — the verdict files (058 FR-030)', () => {
  it('accepts a verdict file for every combination plus the coexistence verdict', () => {
    const r = evaluate(allFiles());
    expect(r.isVerified).toBe(true);
    expect(r.refusal).toBeNull();
    expect(r.reportedGaps).toEqual([]);
  });

  it('refuses when a combination’s file is missing, naming the combination', () => {
    const r = evaluate(allFiles().filter((f) => f.name !== 'verification-verdict-msi-machine.json'));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toContain('msi-machine');
  });

  it('refuses a failed step, naming the combination and the step', () => {
    const files = allFiles().map((f) =>
      f.name.includes('setup-user') ? verdictFile('setup-user', { launch: false }) : f,
    );
    const r = evaluate(files);
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toContain('setup-user: launch');
  });

  it('refuses a missing coexistence verdict, naming coexistence', () => {
    const r = evaluate(allFiles().filter((f) => !f.name.includes('coexistence')));
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toMatch(/coexistence/);
  });

  it('refuses a failing coexistence verdict, naming the step', () => {
    const files = allFiles().map((f) => (f.name.includes('coexistence') ? coexistenceFile('same-data-folder') : f));
    const r = evaluate(files);
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toContain('coexistence: same-data-folder');
  });

  it('refuses a file that is not valid JSON, naming the file — an unreadable verdict is not a pass', () => {
    const files = allFiles().map((f) => (f.name.includes('archive') ? { name: f.name, text: '{ not json' } : f));
    const r = evaluate(files);
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toContain('verification-verdict-archive.json');
  });

  it('refuses a verdict bound to different bytes than the artifact being published', () => {
    const r = evaluateVerdictFiles({
      version: VERSION,
      files: allFiles(),
      actualSha256ByRole: { ...SHA, msi: 'e'.repeat(64) },
    });
    expect(r.isVerified).toBe(false);
    expect(r.refusal).toContain('msi');
  });

  it('accepts unproven on a runner-limited step and reports it', () => {
    const files = allFiles().map((f) =>
      f.name.includes('msi-machine') ? verdictFile('msi-machine', { 'second-account': 'unproven' }) : f,
    );
    const r = evaluate(files);
    expect(r.isVerified).toBe(true);
    expect(r.reportedGaps).toEqual([
      { combination: 'msi-machine', step: 'second-account', reason: 'no interactive desktop for a second account' },
    ]);
  });

  it('reads the reported version from the verdicts, for the four-way version match', () => {
    expect(evaluate(allFiles()).reportedVersion).toBe(VERSION);
  });
});
