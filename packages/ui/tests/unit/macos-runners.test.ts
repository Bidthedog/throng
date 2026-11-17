import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// @ts-expect-error — plain-JS CI script, imported for its pure decisions.
import { findRunnerLabelViolations, runnerOutputs } from '../../../../scripts/macos-runners.mjs';

/**
 * 070 FR-037, SC-011, research R25 — the supported macOS range moves forward with ONE edit: `.github/macos-runners.json`.
 * Every macOS job reads the labels through its workflow's `macos-runners` job, so a label written anywhere else is a
 * second place to change, and the day it is forgotten one release is tested on a machine nobody chose.
 *
 * Layer: unit — reads the repository's own workflow files; nothing runs.
 */

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const workflowFiles = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), 'utf8') }));
const listText = readFileSync(join(ROOT, '.github', 'macos-runners.json'), 'utf8');

describe('the runner list (FR-037)', () => {
  it('names the current and the previous macOS runner, and nothing else', () => {
    const list = JSON.parse(listText) as Record<string, unknown>;
    expect(Object.keys(list).sort()).toEqual(['current', 'previous']);
    expect(typeof list.current).toBe('string');
    expect(typeof list.previous).toBe('string');
    expect(list.current).not.toBe(list.previous);
  });

  it('becomes the job outputs, current first', () => {
    const list = JSON.parse(listText) as { current: string; previous: string };
    expect(runnerOutputs(listText)).toEqual({
      labels: [list.current, list.previous],
      runners: { current: list.current, previous: list.previous },
    });
  });

  it.each([
    ['a missing release', '{ "current": "macos-26" }'],
    ['an unknown key', '{ "current": "a", "previous": "b", "next": "c" }'],
    ['one label twice', '{ "current": "macos-26", "previous": "macos-26" }'],
    ['a label that is not a string', '{ "current": 26, "previous": "macos-25" }'],
    ['a label that could carry an expression', '{ "current": "macos-26 ${{ secrets.X }}", "previous": "macos-25" }'],
    ['not JSON at all', '{ current: macos-26 }'],
  ])('refuses %s, so a bad edit fails the job rather than starting no machine', (_why, text) => {
    expect(() => runnerOutputs(text)).toThrow();
  });
});

describe('no workflow names a macOS runner except through the list (FR-037, SC-011)', () => {
  it('holds for every workflow in .github/workflows', () => {
    const list = JSON.parse(listText) as { current: string; previous: string };
    expect(findRunnerLabelViolations(workflowFiles, [list.current, list.previous], parse)).toEqual([]);
  });

  it('has macOS jobs to hold it to, so the check above is not vacuous', () => {
    const macosJobs = workflowFiles.flatMap(({ name, text }) =>
      [...text.matchAll(/^ {2}([\w-]*macos[\w-]*):\s*$/gm)].map((m) => `${name}:${m[1]}`),
    );
    expect(macosJobs).toEqual(
      expect.arrayContaining([
        'pipeline.yml:macos-runners',
        'pipeline.yml:vitest-macos',
        'pipeline.yml:e2e-macos',
        'pipeline.yml:macos-latency',
        'pipeline.yml:build-macos',
        'pipeline.yml:verify-macos',
      ]),
    );
    // 072: PR CI is Linux-only and release.yml calls the pipeline, so neither carries a macOS job of its own.
    expect(macosJobs.filter((id) => !id.startsWith('pipeline.yml:'))).toEqual([]);
  });

  describe('the check itself', () => {
    const WRITER = '  macos-runners:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/macos-runners.mjs >> "$GITHUB_OUTPUT"\n';
    const job = (runsOn: string, extra = ''): string => `jobs:\n${WRITER}  x:\n    runs-on: ${runsOn}\n${extra}    steps: []\n`;
    const check = (text: string) => findRunnerLabelViolations([{ name: 'w.yml', text }], ['xcode-27', 'macos-26'], parse);
    const FROM_LIST = `    needs: macos-runners\n    strategy:\n      matrix:\n        runner: \${{ fromJSON(needs.macos-runners.outputs.labels) }}\n`;

    it('flags a literal macOS label, naming the file, the line and the label', () => {
      expect(check(job('macos-15'))).toEqual(["w.yml:7: names the macOS runner 'macos-15'; only .github/macos-runners.json may"]);
      expect(check(job('macos-latest'))).toHaveLength(1);
      expect(check(job('[self-hosted, macOS-14-xlarge]'))).toHaveLength(1);
    });

    it('flags a label from the list written out by hand, wherever it appears, once', () => {
      expect(check(`${job('ubuntu-24.04')}# runs on xcode-27 too\n`)).toHaveLength(1);
    });

    it('flags a matrix that lists labels instead of reading the list', () => {
      expect(check(job('${{ matrix.os }}', '    strategy:\n      matrix:\n        os: [ubuntu-24.04, macos-14]\n'))).toHaveLength(1);
    });

    it('leaves job names alone: macos-fast is a job, not a runner', () => {
      expect(check(`${job('ubuntu-24.04')}  macos-fast:\n    runs-on: ubuntu-24.04\n    steps: []\n`)).toEqual([]);
    });

    it('accepts the list, by matrix or by slot', () => {
      expect(check(job('${{ matrix.runner }}', FROM_LIST))).toEqual([]);
      const bySlot = `    needs: [macos-runners]\n    strategy:\n      matrix:\n        include: \${{ fromJSON(needs.macos-runners.outputs.matrix) }}\n`;
      expect(check(job('${{ fromJSON(needs.macos-runners.outputs.runners)[matrix.runner] }}', bySlot))).toEqual([]);
      expect(check(job('windows-2022'))).toEqual([]);
    });

    it('flags a job that reads the outputs without needing the job that writes them', () => {
      const noNeeds = '    strategy:\n      matrix:\n        runner: ${{ fromJSON(needs.macos-runners.outputs.labels) }}\n';
      expect(check(job('${{ matrix.runner }}', noNeeds))).toEqual(['w.yml: x reads the macOS runner list without needing the macos-runners job']);
    });

    it('flags a workflow that reads the list with no job writing it', () => {
      const text = `jobs:\n  x:\n    runs-on: \${{ matrix.runner }}\n${FROM_LIST}    steps: []\n`;
      expect(check(text)).toEqual(['w.yml: has macOS jobs but no macos-runners job running scripts/macos-runners.mjs']);
    });
  });
});
