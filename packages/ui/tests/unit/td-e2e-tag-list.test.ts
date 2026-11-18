/**
 * td's e2e `tag.list` (scripts/td-e2e-tag-list.mjs): Playwright's JSON list flattened into the `{name, file}` array td
 * reads. The names must match what Playwright's JUnit reporter records, or td could never join a listed test to a run:
 * describe titles and the test title joined by " › ", with the file-level suite starting no title.
 *
 * Layer: unit — a pure transform over a report object; nothing runs Playwright.
 */
import { describe, expect, it } from 'vitest';
import { testsFromReport } from '../../../../scripts/td-e2e-tag-list.mjs';

const repoRoot = '/repo';
const report = {
  config: { rootDir: '/repo/packages/ui/tests/e2e' },
  suites: [
    {
      title: 'about.e2e.ts',
      file: 'about.e2e.ts',
      specs: [{ title: 'opens', file: 'about.e2e.ts' }],
      suites: [
        {
          title: 'the about window',
          specs: [{ title: 'shows the version', file: 'about.e2e.ts' }],
          suites: [{ title: 'when offline', specs: [{ title: 'still opens', file: 'about.e2e.ts' }] }],
        },
      ],
    },
  ],
};

describe('td e2e tag listing', () => {
  it('names each test by its describe path, and its file from the repository root', () => {
    expect(testsFromReport(report, repoRoot)).toEqual([
      { name: 'opens', file: 'packages/ui/tests/e2e/about.e2e.ts' },
      { name: 'the about window › shows the version', file: 'packages/ui/tests/e2e/about.e2e.ts' },
      { name: 'the about window › when offline › still opens', file: 'packages/ui/tests/e2e/about.e2e.ts' },
    ]);
  });

  it('reads a report with no tests as an empty list', () => {
    expect(testsFromReport({ config: { rootDir: '/repo' }, suites: [] }, repoRoot)).toEqual([]);
  });
});
