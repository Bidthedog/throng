import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 064 FR-011, FR-012, FR-015: the static files a user's machine is configured from. A mistake here is not noticed until
 * someone follows the instructions, and it then fails on their machine, not ours.
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const installDoc = read('docs/install-linux.md');

describe('the channel files (064 FR-004, FR-012)', () => {
  it.each(['stable', 'prerelease'])('the %s mirror list sends indexes to the site and packages to GitHub', (channel) => {
    expect(read(`site/apt/${channel}.list`).trim().split('\n')).toEqual([
      'https://throng-ide.com/apt/\tpriority:1\ttype:index',
      'https://github.com/\tpriority:1\ttype:deb',
    ]);
  });

  it.each(['stable', 'prerelease'])('the %s repo file checks the signed metadata, and names its own channel', (channel) => {
    const repo = read(`site/rpm/throng-${channel}.repo`);
    expect(repo).toContain(`baseurl=https://throng-ide.com/rpm/${channel}\n`);
    expect(repo).toContain('repo_gpgcheck=1\n');
    expect(repo).toContain('gpgkey=https://throng-ide.com/throng-repo-key.asc\n');
  });
});

describe('the instructions (064 FR-011, FR-015)', () => {
  it('trust the key for throng alone', () => {
    expect(installDoc).toContain('[signed-by=/usr/share/keyrings/throng.asc]');
    expect(installDoc).not.toContain('apt-key');
    expect(installDoc).not.toContain('/etc/apt/trusted.gpg');
  });

  it('only name channel files that exist', () => {
    const urls = [...installDoc.matchAll(/https:\/\/throng-ide\.com\/((?:apt|rpm)\/[\w.-]+\.(?:list|repo))/g)].map((m) => m[1] as string);
    expect(urls.length).toBeGreaterThan(0);
    for (const path of urls) expect(existsSync(join(ROOT, 'site', path)), path).toBe(true);
  });
});
