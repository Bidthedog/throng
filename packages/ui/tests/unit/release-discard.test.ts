/**
 * 072 FR-031: a release attempt that failed on a test or a build is discarded and the SAME version re-tagged. The tag
 * and the attempt's installers and packages go; the test evidence stays; a published release is never touched.
 *
 * Layer: unit. `scripts/release-discard.mjs` takes the GitHub API as an injected object.
 */
import { describe, expect, it } from 'vitest';
import { isBuildArtifact, releaseFromGh, runDiscard } from '../../../../scripts/release-discard.mjs';

describe('releaseFromGh', () => {
  // Only GitHub's 404 means "not published". Anything else — a rate limit, a 5xx, no auth — must stop the discard,
  // or a transient error would let it delete a published release's tag (072 code review).
  it('reads a release, and treats only a 404 as none', () => {
    expect(releaseFromGh({ status: 0, stdout: '{"tag_name":"v1"}', stderr: '' })).toEqual({ tag_name: 'v1' });
    expect(releaseFromGh({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })).toBeUndefined();
  });

  it('throws on every other failure', () => {
    for (const stderr of ['gh: Server Error (HTTP 502)', 'API rate limit exceeded (HTTP 403)', 'error connecting']) {
      expect(() => releaseFromGh({ status: 1, stdout: '', stderr }), stderr).toThrow(/release/);
    }
  });
});

function fakeApi({ release = false, runs = [11, 12] } = {}) {
  const calls: string[] = [];
  const artifacts: Record<number, { id: number; name: string }[]> = {
    11: [
      { id: 1, name: 'throng-windows-x64' },
      { id: 2, name: 'test-results-windows-unit' },
      { id: 3, name: 'msi-upgrade-fixture' },
      { id: 4, name: 'repo-index-bundle' },
    ],
    12: [
      { id: 5, name: 'release-body' },
      { id: 6, name: 'e2e-report-linux-1' },
      { id: 7, name: 'installer-logs-windows' },
      { id: 8, name: 'verdict-full' },
    ],
  };
  return {
    calls,
    api: {
      getRelease: async (tag: string) => {
        calls.push(`release? ${tag}`);
        return release ? { tag_name: tag, html_url: 'https://example.test/r' } : undefined;
      },
      listReleaseRuns: async (tag: string) => {
        calls.push(`runs ${tag}`);
        return runs.map((id) => ({ id }));
      },
      listArtifacts: async (runId: number) => artifacts[runId] ?? [],
      deleteArtifact: async (id: number) => {
        calls.push(`delete artifact ${id}`);
      },
      deleteTag: async (tag: string) => {
        calls.push(`delete tag ${tag}`);
      },
    },
  };
}

describe('isBuildArtifact', () => {
  it('names installers, packages, fixtures, the repository bundle and the body as build artifacts', () => {
    for (const n of ['throng-windows-x64', 'throng-linux-deb', 'msi-upgrade-fixture', 'repo-index-bundle', 'release-body']) {
      expect(isBuildArtifact(n), n).toBe(true);
    }
  });

  it('keeps test evidence', () => {
    for (const n of ['test-results-windows-unit', 'json-results-vitest-linux-unit', 'e2e-report-linux-1', 'installer-logs-windows', 'verdict-full', 'playwright-report']) {
      expect(isBuildArtifact(n), n).toBe(false);
    }
  });
});

describe('runDiscard', () => {
  it('refuses with exit 3 and deletes nothing when the release is published', async () => {
    const { api, calls } = fakeApi({ release: true });
    const lines: string[] = [];
    expect(await runDiscard({ api, tag: 'v1.0.0-alpha18', dryRun: false, log: (l: string) => lines.push(l) })).toBe(3);
    expect(calls).toEqual(['release? v1.0.0-alpha18']);
    expect(lines.join('\n')).toMatch(/published/i);
  });

  it('deletes the build artifacts of every run on the tag, then the tag, and keeps the evidence', async () => {
    const { api, calls } = fakeApi();
    expect(await runDiscard({ api, tag: 'v1.0.0-alpha18', dryRun: false, log: () => {} })).toBe(0);
    expect(calls).toEqual([
      'release? v1.0.0-alpha18',
      'runs v1.0.0-alpha18',
      'delete artifact 1',
      'delete artifact 3',
      'delete artifact 4',
      'delete artifact 5',
      'delete tag v1.0.0-alpha18',
    ]);
  });

  it('prints the plan and deletes nothing on --dry-run', async () => {
    const { api, calls } = fakeApi();
    const lines: string[] = [];
    expect(await runDiscard({ api, tag: 'v1.0.0-alpha18', dryRun: true, log: (l: string) => lines.push(l) })).toBe(0);
    expect(calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    const out = lines.join('\n');
    expect(out).toContain('throng-windows-x64');
    expect(out).toContain('release-body');
    expect(out).toMatch(/keep.*test-results-windows-unit/);
    expect(out).toMatch(/tag v1\.0\.0-alpha18/);
  });

  it('rejects anything that is not a v* tag', async () => {
    const { api, calls } = fakeApi();
    expect(await runDiscard({ api, tag: 'master', dryRun: false, log: () => {} })).toBe(64);
    expect(calls).toEqual([]);
  });
});
