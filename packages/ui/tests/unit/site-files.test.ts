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

describe('the website (064 FR-001, FR-002)', () => {
  const page = read('site/index.html');
  const script = read('site/assets/site.js');
  const style = read('site/assets/site.css');
  const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it('gives the same Linux commands as the install guide, line for line', () => {
    const blocks = [...page.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => unescape(m[1] as string));
    expect(blocks.length).toBe(2);
    for (const block of blocks) for (const line of block.split('\n')) expect(installDoc, line).toContain(line);
  });

  it('loads nothing from another origin but the build badges, and only the YouTube player from script', () => {
    const sources = [...page.matchAll(/<(?:script|img|iframe)[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1] as string);
    const badges = sources.filter((url) => /^https:\/\//.test(url));
    expect(badges.length).toBeGreaterThan(0);
    for (const url of badges) {
      expect(url, url).toMatch(/^https:\/\/(?:img\.shields\.io\/|github\.com\/Bidthedog\/throng\/actions\/workflows\/[\w.-]+\/badge\.svg)/);
    }
    const loads = [
      ...sources.filter((url) => !badges.includes(url)),
      ...[...page.matchAll(/<link[^>]*\shref="([^"]+)"/g)].filter((m) => !/rel="canonical"/.test(m[0])).map((m) => m[1] as string),
      ...[...style.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] as string),
    ];
    expect(loads.length).toBeGreaterThan(0);
    for (const url of loads) {
      expect(url, url).not.toMatch(/^(?:https?:)?\/\//);
      expect(existsSync(join(ROOT, 'site', 'assets', url.replace(/^assets\//, ''))) || existsSync(join(ROOT, 'site', url)), url).toBe(true);
    }
    expect([...script.matchAll(/https:\/\/[\w.-]+/g)].map((m) => m[0])).toEqual(['https://www.youtube-nocookie.com']);
  });

  it('leads with the four features in the agreed order', () => {
    const headings = [...page.matchAll(/<section class="feature"[\s\S]*?<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(['Projects and workspaces', 'Panels', 'Persistent terminals', 'Editor and Markdown previews']);
  });

  it('is described to search engines and link previews', () => {
    expect(read('site/robots.txt')).toContain('Sitemap: https://throng-ide.com/sitemap.xml');
    expect(read('site/sitemap.xml')).toContain('<loc>https://throng-ide.com/</loc>');
    expect(page).toContain('<link rel="canonical" href="https://throng-ide.com/">');
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? 'null');
    expect(ld).toMatchObject({ '@type': 'SoftwareApplication', name: 'throng' });
    for (const asset of ['favicon.ico', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/social-card.png']) {
      expect(existsSync(join(ROOT, 'site', asset)), asset).toBe(true);
    }
    const manifest = JSON.parse(read('site/site.webmanifest')) as { icons: { src: string }[] };
    for (const icon of manifest.icons) expect(existsSync(join(ROOT, 'site', icon.src)), icon.src).toBe(true);
  });

  it('gives language models a summary whose links point at docs that exist', () => {
    const llms = read('site/llms.txt');
    expect(llms.startsWith('# throng\n\n> ')).toBe(true);
    const docs = [...llms.matchAll(/github\.com\/Bidthedog\/throng\/blob\/master\/([\w./-]+)\)/g)].map((m) => m[1] as string);
    expect(docs.length).toBeGreaterThan(5);
    for (const doc of docs) expect(existsSync(join(ROOT, doc)), doc).toBe(true);
  });

  it('opens every external link in a new tab, without handing it the page', () => {
    const external = [...page.matchAll(/<a\s[^>]*href="https?:\/\/[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(external.length).toBeGreaterThan(5);
    for (const tag of external) {
      expect(tag, tag).toContain('target="_blank"');
      expect(tag, tag).toContain('rel="noopener"');
    }
  });

  it('enlarges each screenshot that has more to show, from a full-size file that exists', () => {
    const zooms = [...page.matchAll(/<a class="zoom" href="([^"]+)"[^>]*><img src="([^"]+)"/g)].map((m) => [m[1] as string, m[2] as string]);
    expect(zooms.length).toBe(4);
    for (const [full] of zooms) expect(existsSync(join(ROOT, 'site', full)), full).toBe(true);
  });

  it('offers an install tab for every supported system, each with its own panel', () => {
    for (const os of ['windows', 'linux', 'macos']) {
      expect(page).toContain(`data-os="${os}"`);
      expect(page).toContain(`id="panel-${os}"`);
    }
  });
});
