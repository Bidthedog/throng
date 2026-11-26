import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build/CI script.
import { assembleSite, latestReleaseTag } from '../../../../scripts/site.mjs';

/**
 * 064 FR-008, SC-004. A Pages deployment replaces the whole site, so each one has to bring the repositories with it.
 * Runs real `tar` in a temp folder: the archive layout is what is under test, and it takes milliseconds.
 */

let root: string;

function writeSite(page = '<h1>throng</h1>'): string {
  const source = join(root, 'source');
  mkdirSync(join(source, 'apt'), { recursive: true });
  writeFileSync(join(source, 'index.html'), page);
  writeFileSync(join(source, 'apt', 'stable.list'), 'mirror list');
  writeFileSync(join(source, 'throng-repo-key.asc'), 'public key');
  return source;
}

/** A bundle as `package-repo.mjs bundle` lays it out. */
function writeBundle(version: string, channels: string[]): string {
  const dir = join(root, `bundle-${version}`);
  for (const channel of channels) {
    mkdirSync(join(dir, 'apt', 'dists', channel), { recursive: true });
    mkdirSync(join(dir, 'rpm', channel, 'repodata'), { recursive: true });
    writeFileSync(join(dir, 'apt', 'dists', channel, 'InRelease'), `${version} ${channel}`);
    writeFileSync(join(dir, 'rpm', channel, 'repodata', 'repomd.xml'), `${version} ${channel}`);
  }
  const path = join(root, `throng-repo-index-${version}.tar.gz`);
  execFileSync('tar', ['-czf', path, '-C', dir, 'apt', 'rpm']);
  return path;
}

const release = (version: string, prerelease = version.includes('-')): object => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease,
  assets: [{ name: `throng-repo-index-${version}.tar.gz` }],
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-site-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// The script only ever runs on a Linux runner or a maintainer's Linux machine, and a Windows runner's `tar` may be GNU
// tar from Git, which reads `C:` as a remote host.
describe.skipIf(process.platform === 'win32')('assembleSite (064 FR-008)', () => {
  it('lays each channel from the release that serves it', async () => {
    const stable = writeBundle('1.0.0', ['stable', 'prerelease']);
    const pre = writeBundle('1.1.0-alpha1', ['prerelease']);
    const out = join(root, 'out');
    await assembleSite({
      source: writeSite(),
      out,
      listReleases: async () => [release('1.1.0-alpha1'), release('1.0.0')],
      fetchBundle: async ({ asset }: { asset: string }) => (asset.includes('alpha') ? pre : stable),
    });
    expect(readFileSync(join(out, 'apt/dists/stable/InRelease'), 'utf8')).toBe('1.0.0 stable');
    expect(readFileSync(join(out, 'apt/dists/prerelease/InRelease'), 'utf8')).toBe('1.1.0-alpha1 prerelease');
    expect(readFileSync(join(out, 'rpm/stable/repodata/repomd.xml'), 'utf8')).toBe('1.0.0 stable');
    expect(readFileSync(join(out, 'rpm/prerelease/repodata/repomd.xml'), 'utf8')).toBe('1.1.0-alpha1 prerelease');
    expect(readFileSync(join(out, 'apt/stable.list'), 'utf8')).toBe('mirror list');
    expect(existsSync(join(out, '.nojekyll'))).toBe(true);
  });

  it('leaves the stable channel absent while only prereleases exist (SC-005)', async () => {
    const pre = writeBundle('1.0.0-alpha13', ['prerelease']);
    const out = join(root, 'out');
    await assembleSite({
      source: writeSite(),
      out,
      listReleases: async () => [release('1.0.0-alpha13')],
      fetchBundle: async () => pre,
    });
    expect(existsSync(join(out, 'apt/dists/prerelease/InRelease'))).toBe(true);
    expect(existsSync(join(out, 'apt/dists/stable'))).toBe(false);
    expect(existsSync(join(out, 'rpm/stable'))).toBe(false);
  });

  it('a change to the static files leaves the repositories byte-identical (SC-004)', async () => {
    const pre = writeBundle('1.0.0-alpha13', ['prerelease']);
    const options = { listReleases: async () => [release('1.0.0-alpha13')], fetchBundle: async () => pre };
    const first = join(root, 'first');
    const second = join(root, 'second');
    await assembleSite({ source: writeSite('<h1>one</h1>'), out: first, ...options });
    await assembleSite({ source: writeSite('<h1>two</h1>'), out: second, ...options });
    expect(readFileSync(join(second, 'index.html'), 'utf8')).toBe('<h1>two</h1>');
    const file = 'apt/dists/prerelease/InRelease';
    expect(readFileSync(join(second, file))).toEqual(readFileSync(join(first, file)));
  });

  it('fails when a bundle cannot be fetched, rather than deploying a site with no repository', async () => {
    await expect(
      assembleSite({
        source: writeSite(),
        out: join(root, 'out'),
        listReleases: async () => [release('1.0.0-alpha13')],
        fetchBundle: async () => {
          throw new Error('404');
        },
      }),
    ).rejects.toThrow('404');
  });

  it('fails when a bundle does not hold the channel it should', async () => {
    const stableOnlyByMistake = writeBundle('1.0.0', ['prerelease']);
    await expect(
      assembleSite({
        source: writeSite(),
        out: join(root, 'out'),
        listReleases: async () => [release('1.0.0')],
        fetchBundle: async () => stableOnlyByMistake,
      }),
    ).rejects.toThrow(/stable/);
  });

  it('refuses to deploy with no public key, which every instruction downloads', async () => {
    const source = writeSite();
    rmSync(join(source, 'throng-repo-key.asc'));
    await expect(
      assembleSite({ source, out: join(root, 'out'), listReleases: async () => [], fetchBundle: async () => '' }),
    ).rejects.toThrow(/throng-repo-key\.asc/);
  });

  it('deploys the static files alone when no release has a bundle yet', async () => {
    const out = join(root, 'out');
    await assembleSite({ source: writeSite(), out, listReleases: async () => [], fetchBundle: async () => '' });
    expect(readFileSync(join(out, 'apt/stable.list'), 'utf8')).toBe('mirror list');
    expect(existsSync(join(out, 'apt/dists'))).toBe(false);
  });

  it('removes what a previous assembly left behind', async () => {
    const out = join(root, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'stale.html'), 'old');
    await assembleSite({ source: writeSite(), out, listReleases: async () => [], fetchBundle: async () => '' });
    expect(existsSync(join(out, 'stale.html'))).toBe(false);
  });
});

/** 080 FR-002b — every deployment builds from the newest published release, never from master. */
describe('latestReleaseTag (080 FR-002b)', () => {
  it('is the newest published v* release, a prerelease included, a draft never', () => {
    expect(
      latestReleaseTag([
        release('1.0.0-beta2'),
        { ...release('1.0.0-beta4'), draft: true },
        release('1.0.0-beta3'),
        release('0.9.0', false),
      ]),
    ).toBe('v1.0.0-beta3');
  });

  it('ignores a tag that is not a version', () => {
    expect(latestReleaseTag([release('1.0.0-beta2'), { tag_name: 'nightly', draft: false, assets: [] }])).toBe(
      'v1.0.0-beta2',
    );
  });

  it('refuses when nothing is published, rather than falling back to master', () => {
    expect(() => latestReleaseTag([{ ...release('1.0.0'), draft: true }])).toThrow(
      /no published release to build the site from/,
    );
  });
});

/** 080 FR-002, FR-002a, FR-002b, SC-006 — the guide joins the site, and every page says which release it is. */
describe.skipIf(process.platform === 'win32')('assembleSite with the guide (080)', () => {
  const FIXTURES = join(__dirname, '../fixtures/guide');

  it('builds the guide and the three references with their section pages, and stamps one version on every page but the repositories', async () => {
    const out = join(root, 'out');
    const source = join(root, 'site');
    cpSync(join(FIXTURES, 'site'), source, { recursive: true });
    writeFileSync(join(source, 'throng-repo-key.asc'), 'public key');
    mkdirSync(join(source, 'apt'), { recursive: true });
    writeFileSync(join(source, 'apt', 'note.html'), '<p>repository</p>');
    cpSync(join(FIXTURES, 'guide'), join(source, 'guide'), { recursive: true });
    await assembleSite({
      source,
      out,
      version: '1.0.0-beta3',
      guide: { guideSource: join(source, 'guide'), docsSource: join(FIXTURES, 'docs'), tag: 'v1.0.0-beta3' },
      listReleases: async () => [],
      fetchBundle: async () => '',
    });
    expect(existsSync(join(out, 'guide', 'terminals', 'index.html'))).toBe(true);
    // site/guide/ is source: rendered, never served as Markdown.
    expect(existsSync(join(out, 'guide', 'terminals.md'))).toBe(false);
    for (const ref of ['preferences/general', 'key-bindings/view', 'theme-settings/main-panel--workspace']) {
      expect(existsSync(join(out, 'guide', 'reference', ...ref.split('/'), 'index.html')), ref).toBe(true);
      expect(existsSync(join(out, 'guide', 'reference', ref.split('/')[0] as string, 'index.html')), ref).toBe(true);
    }
    const pages = htmlFiles(out).filter((p) => !/[\\/](apt|rpm)[\\/]/.test(p));
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
      const labels = [...readFileSync(page, 'utf8').matchAll(/data-site-version>([^<]*)</g)].map((m) => m[1]);
      expect(labels.length, page).toBeGreaterThan(0);
      expect(new Set(labels), page).toEqual(new Set(['v1.0.0-beta3']));
    }
  });

  it('leaves the guide out when it is not asked for, as a release from before the guide does', async () => {
    const out = join(root, 'out');
    await assembleSite({ source: writeSite(), out, listReleases: async () => [], fetchBundle: async () => '' });
    expect(existsSync(join(out, 'guide'))).toBe(false);
  });
});

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => join(e.parentPath, e.name));
}
