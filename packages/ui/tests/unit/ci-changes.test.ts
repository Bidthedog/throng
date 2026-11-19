import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS CI script, imported for its pure decision.
import { INERT_PATHS, affectsCi, decide } from '../../../../scripts/ci-changes.mjs';

/**
 * 072 FR-004a — PR CI skips its work jobs when every file a pull request changes is one no job reads: the verdict cannot
 * be anything but green, so nobody waits for it. `scripts/ci-changes.mjs` answers for ci.yml's `changes` job.
 *
 * Layer: unit. The decision is a pure function of the changed paths; ci.yml's wiring is ci-workflow.test.ts's.
 */

describe('which paths can affect a PR CI job (072 FR-004a)', () => {
  it('treats Spec Kit, specs, agent material and the GitHub templates as inert', () => {
    for (const path of [
      '.specify/memory/constitution.md',
      '.specify/templates/plan-template.md',
      'specs/076-terminal-status-bar-toggles/spec.md',
      'specs/076-terminal-status-bar-toggles/contracts/status-bar-and-menu.md',
      '.claude/.manual-test-plans/feature+S076-I669-terminal-status-bar-toggles.md',
      '.claude/skills/throng-testing/SKILL.md',
      '.claude/settings.json',
      'CLAUDE.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      '.github/ISSUE_TEMPLATE/bug_report.yml',
    ]) {
      expect(affectsCi(path), path).toBe(false);
    }
  });

  it('treats source, tests, configuration, scripts and workflows as able to affect a job', () => {
    for (const path of [
      'packages/ui/src/renderer/terminal/terminal.css',
      'packages/core/tests/unit/terminal-panel-toggles.test.ts',
      'package.json',
      'package-lock.json',
      'eslint.config.js',
      'vitest.config.ts',
      'scripts/ci-changes.mjs',
      '.github/workflows/ci.yml',
      '.github/actions/install-electron/action.yml',
      '.github/macos-runners.json',
      '.claude/worktree-prep.json',
      'packaging/nsis/UPSTREAM.md',
      'packages/ui/tests/fixtures/links/notes.md',
    ]) {
      expect(affectsCi(path), path).toBe(true);
    }
  });

  it('treats the docs a test reads as able to affect a job: docs-currency.test.ts and others read them', () => {
    for (const path of ['docs/preferences.md', 'README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md']) {
      expect(affectsCi(path), path).toBe(true);
    }
  });

  it('treats any JS or TS file as able to affect a job, even under an inert folder: eslint lints it', () => {
    for (const path of ['specs/076-x/survey.mjs', '.github/ISSUE_TEMPLATE/check.ts', 'specs/a/b.tsx', 'specs/a/c.cjs']) {
      expect(affectsCi(path), path).toBe(true);
    }
  });

  it('fails safe on a path nobody declared inert', () => {
    expect(affectsCi('something-new/file.txt')).toBe(true);
    expect(affectsCi('specs-but-not-really.ts')).toBe(true);
  });

  it('declares each inert path as an anchored pattern', () => {
    expect(INERT_PATHS.length).toBeGreaterThan(0);
    for (const pattern of INERT_PATHS) expect(pattern.source.startsWith('^'), String(pattern)).toBe(true);
  });
});

describe('the answer for a whole pull request', () => {
  it('runs the jobs when any one changed file can affect them', () => {
    expect(decide(['specs/076-x/spec.md', 'packages/core/src/index.ts'])).toEqual({
      code: true,
      relevant: ['packages/core/src/index.ts'],
    });
  });

  it('skips them only when every changed file is inert', () => {
    expect(decide(['.specify/memory/constitution.md', 'specs/076-x/spec.md'])).toEqual({ code: false, relevant: [] });
  });

  it('runs them when the change list is empty or could not be read', () => {
    expect(decide([]).code).toBe(true);
    expect(decide(['', '  ']).code).toBe(true);
  });
});
