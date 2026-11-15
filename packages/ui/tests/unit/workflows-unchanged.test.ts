import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// @ts-expect-error — plain-JS CI script, imported for its pure comparison.
import { isMacosJob, platformJobDifferences } from '../../../../scripts/check-platform-jobs-unchanged.mjs';

/**
 * 070 FR-039, T061 — the Windows and Linux jobs stay as they were; the only change allowed to one is naming a macOS
 * job it needs. `scripts/check-platform-jobs-unchanged.mjs` runs that comparison once, at the end of the branch, against
 * the merge base with master. This is its decision, held to small workflows written for each case.
 *
 * Layer: unit — a pure comparison of parsed YAML; git is the script's thin outside.
 */

const BEFORE = `
on: [push]
env:
  npm_config_loglevel: error
jobs:
  build-linux:
    runs-on: ubuntu-22.04
    steps:
      - run: npm run package:linux
  render-body:
    needs: [build-installer, build-linux]
    if: \${{ !cancelled() && needs.build-installer.result == 'success' && needs.build-linux.result == 'success' }}
    runs-on: windows-2022
    steps:
      - run: node scripts/release-notes.mjs render
  publish:
    needs: render-body
    if: >-
      \${{ !cancelled() && needs.render-body.result == 'success' }}
    runs-on: windows-2022
    steps:
      - run: gh release create
`;

const compare = (after: string): string[] => platformJobDifferences('release.yml', parse(BEFORE), parse(after));

describe('which jobs are macOS ones', () => {
  it('is any job whose id names macOS', () => {
    for (const id of ['macos-runners', 'macos-fast', 'gate-macos', 'build-macos', 'verify-macos']) expect(isMacosJob(id)).toBe(true);
    for (const id of ['build-linux', 'render-body', 'gate', 'e2e']) expect(isMacosJob(id)).toBe(false);
  });
});

describe('platformJobDifferences (FR-039)', () => {
  it('finds nothing when the workflow is unchanged', () => {
    expect(compare(BEFORE)).toEqual([]);
  });

  it('allows a new macOS job, and a macOS need with its success term in a job that existed', () => {
    const after = `
on: [push]
env:
  npm_config_loglevel: error
jobs:
  build-linux:
    runs-on: ubuntu-22.04
    steps:
      - run: npm run package:linux
  build-macos:
    runs-on: \${{ matrix.runner }}
    steps:
      - run: npm run package
  render-body:
    needs: [build-installer, build-linux, build-macos]
    if: \${{ !cancelled() && needs.build-installer.result == 'success' && needs.build-linux.result == 'success' && needs.build-macos.result == 'success' }}
    runs-on: windows-2022
    steps:
      - run: node scripts/release-notes.mjs render
  publish:
    needs: [render-body, build-macos]
    if: >-
      \${{ !cancelled() && needs.build-macos.result == 'success'
      && needs.render-body.result == 'success' }}
    runs-on: windows-2022
    steps:
      - run: gh release create
`;
    expect(compare(after)).toEqual([]);
  });

  it('flags a changed step in a Windows or Linux job', () => {
    expect(compare(BEFORE.replace('npm run package:linux', 'npm run package:linux -- --x64'))).toEqual([
      "release.yml: build-linux's 'steps' changed",
    ]);
  });

  it('flags a changed runner', () => {
    expect(compare(BEFORE.replace('ubuntu-22.04', 'ubuntu-24.04'))).toEqual(["release.yml: build-linux's 'runs-on' changed"]);
  });

  it('flags a need on a job that is not macOS, and a condition loosened, even beside an allowed change', () => {
    const after = BEFORE.replace('needs: [build-installer, build-linux]', 'needs: [build-installer, build-linux, coexistence]').replace(
      " && needs.build-linux.result == 'success' }}",
      ' }}',
    );
    expect(compare(after)).toEqual(["release.yml: render-body's 'needs' changed", "release.yml: render-body's 'if' changed"]);
  });

  it('flags a removed job and a new job that is not macOS', () => {
    const after = BEFORE.replace(/ {2}build-linux:[\s\S]*?(?= {2}render-body:)/, '  build-arm:\n    runs-on: ubuntu-24.04-arm\n    steps: []\n');
    expect(compare(after)).toEqual(['release.yml: build-linux was removed', 'release.yml: build-arm is new and is not a macOS job']);
  });

  it('flags a change to the workflow every job runs under', () => {
    expect(compare(BEFORE.replace('npm_config_loglevel: error', 'npm_config_loglevel: warn'))).toEqual([
      "release.yml: the workflow's 'env' changed, and every job runs under it",
    ]);
  });
});
