import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 064 FR-009, FR-010, FR-013, FR-014: who can reach the signing key, and what a repository update waits for. These are
 * properties of the workflow's shape, which only a real publish would otherwise exercise, and a real publish happens
 * too rarely to find out then.
 */

const ROOT = process.cwd();

interface Job {
  needs?: string | string[];
  environment?: string | { name: string };
  if?: string;
  steps?: { env?: Record<string, string>; run?: string }[];
}
const load = (name: string): { jobs: Record<string, Job> } =>
  parse(readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8')) as { jobs: Record<string, Job> };

const release = load('release.yml');
const pages = load('pages.yml');
const needsOf = (job: Job): string[] => [job.needs ?? []].flat();

describe('the repository signing key (064 FR-009)', () => {
  it('only a job behind the release Environment can read it', () => {
    const readers = Object.entries(release.jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.REPO_SIGNING_KEY'));
    expect(readers.map(([name]) => name)).toEqual(['sign-index']);
    expect(readers[0]?.[1].environment).toBe('release');
  });

  it('no deployment can read it', () => {
    expect(JSON.stringify(pages)).not.toContain('REPO_SIGNING_KEY');
  });

  it('is a file nobody can commit by accident', () => {
    expect(JSON.stringify(release)).not.toContain('BEGIN PGP PRIVATE');
  });
});

describe('what the repositories wait for (064 FR-010, FR-013)', () => {
  it('they change only after the release has published, and only from a signed bundle', () => {
    const deploy = release.jobs['deploy-repositories'] as Job;
    expect(needsOf(deploy).sort()).toEqual(['publish', 'sign-index']);
    expect(deploy.environment).toBeUndefined();
  });

  it('signing waits for exactly what publishing waits for', () => {
    const sign = release.jobs['sign-index'] as Job;
    const publish = release.jobs.publish as Job;
    expect(needsOf(sign)).toEqual(needsOf(publish));
    expect(sign.if).toBe(publish.if);
  });

  it('a failed route check blocks publication', () => {
    expect(needsOf(release.jobs.publish as Job)).toContain('verify-repositories');
  });

  it('nothing else in the pipeline deploys the site', () => {
    const dispatchers = Object.entries(release.jobs).filter(([, job]) => JSON.stringify(job).includes('workflow run pages.yml'));
    expect(dispatchers.map(([name]) => name)).toEqual(['deploy-repositories']);
  });
});

describe('Windows stays as it is (064 FR-014)', () => {
  it('publish still runs on the runner it did, in the Environment it did', () => {
    const raw = parse(readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')) as { jobs: Record<string, Record<string, unknown>> };
    expect(raw.jobs.publish?.['runs-on']).toBe('windows-2022');
    expect(raw.jobs.publish?.environment).toBe('release');
  });
});
