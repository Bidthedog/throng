import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build script.
import { buildGuide } from '../../../../scripts/guide-build.mjs';

/**
 * 080 FR-002a, FR-002b, FR-002c, FR-003; US1 AC5 and AC6 — every guide page wears the home page's own header
 * and footer (lifted from `site/index.html`, not copied), the one stylesheet, the search field and the
 * version it was built from. One build shared by every read-only test in the file.
 */

const FIXTURES = join(__dirname, '../fixtures/guide');
let root: string;
let siteIndex: string;
let terminals: string;

/** One element's outer HTML, by its opening tag. */
function element(html: string, open: RegExp, close: string): string {
  const start = html.search(open);
  if (start < 0) return '';
  return html.slice(start, html.indexOf(close, start) + close.length);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-guide-template-'));
  cpSync(FIXTURES, join(root, 'src'), { recursive: true });
  siteIndex = readFileSync(join(root, 'src', 'site', 'index.html'), 'utf8');
  await buildGuide({
    guideSource: join(root, 'src', 'guide'),
    docsSource: join(root, 'src', 'docs'),
    siteIndexHtml: siteIndex,
    out: join(root, 'out'),
    version: '1.0.0-beta3',
    tag: 'v1.0.0-beta3',
  });
  terminals = readFileSync(join(root, 'out', 'guide', 'terminals', 'index.html'), 'utf8');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the guide page template', () => {
  it("wears the home page's header, with same-page anchors made absolute", () => {
    const home = element(siteIndex, /<header class="top">/, '</header>');
    const header = element(terminals, /<header class="top">/, '</header>');
    expect(header).toContain('href="/#features"');
    expect(header).toContain('<a class="brand" href="/">');
    // Apart from the absolute anchors, the search field and the version, it is the same header.
    expect(home.replace('href="#features"', 'href="/#features"').replace('<span class="site-version" data-site-version></span>', '')).toBe(
      header
        .replace(/<div class="guide-search"[^>]*><\/div>/, '')
        .replace(/<span class="site-version" data-site-version>[^<]*<\/span>/, ''),
    );
  });

  it("holds brand, search, the home page's nav and the version, in that order (FR-029, D3)", () => {
    const header = element(terminals, /<header class="top">/, '</header>');
    const at = [
      header.indexOf('<a class="brand"'),
      header.indexOf('<div class="guide-search" id="search"></div>'),
      header.indexOf('<nav aria-label="Site">'),
      header.indexOf('<span class="site-version"'),
    ];
    expect(at.every((i) => i >= 0), at.join(',')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("wears the home page's footer", () => {
    const footer = element(terminals, /<footer class="foot">/, '</footer>');
    expect(footer).toContain('This site sets no cookies and collects nothing.');
    expect(footer).toContain('href="/#top"');
  });

  it('puts the footer in the page column, beside the navigation, so the page list never moves (FR-039)', () => {
    const grid = terminals.slice(terminals.indexOf('<div class="guide">'));
    const body = grid.indexOf('<div class="guide-body">');
    expect(body, 'the page column').toBeGreaterThan(grid.indexOf('<nav class="guide-nav"'));
    expect(grid.indexOf('<main'), 'main inside the page column').toBeGreaterThan(body);
    expect(grid.indexOf('<footer class="foot">'), 'the footer after main, in the page column').toBeGreaterThan(grid.indexOf('</main>'));
  });

  it('loads the one stylesheet, by absolute path', () => {
    expect(terminals).toContain('<link rel="stylesheet" href="/assets/site.css">');
  });

  it('names the version it was built from in the header only, with no line of its own (FR-047)', () => {
    expect(terminals).toContain('<span class="site-version" data-site-version>v1.0.0-beta3</span>');
    expect(terminals).not.toContain('This guide describes');
  });

  it('marks the page body for search, and carries the search field', () => {
    expect(terminals).toMatch(/<main[^>]*data-pagefind-body/);
    expect(terminals).toContain('<div class="guide-search" id="search"></div>');
    expect(terminals).toContain('/pagefind/pagefind-ui.js');
  });

  it('lists every page in order, then each reference as a closed expandable item, marking the current page', () => {
    const nav = element(terminals, /<nav class="guide-nav"/, '</nav>');
    const pages = [...nav.matchAll(/<li><a [^>]*>([^<]+)<\/a><\/li>/g)].slice(0, 3).map((m) => m[1]);
    expect(pages).toEqual(['Intro', 'Quick start', 'Terminals']);
    const refs = [...nav.matchAll(/<details class="guide-nav__ref"( open)?><summary>([^<]+)<\/summary>/g)];
    expect(refs.map((m) => m[2])).toEqual(['Preferences reference', 'Key bindings reference', 'Theme settings reference']);
    expect(refs.map((m) => m[1] ?? '')).toEqual(['', '', '']);
    expect(nav).toContain('<a href="/guide/terminals/" aria-current="page">Terminals</a>');
  });

  it("titles the page with its own title and the guide's", () => {
    expect(terminals).toContain('<title>Terminals · throng guide</title>');
  });

  it('carries no outline notice', () => {
    expect(terminals).not.toContain('guide-outline');
  });
});

describe('an outline page (FR-033)', () => {
  it('refuses the build, naming the page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-guide-outline-'));
    try {
      cpSync(FIXTURES, join(dir, 'src'), { recursive: true });
      const terminalsSource = join(dir, 'src', 'guide', 'terminals.md');
      writeFileSync(
        terminalsSource,
        readFileSync(terminalsSource, 'utf8').replace('order: 2\n', 'order: 2\nstatus: outline\n'),
      );
      await expect(
        buildGuide({
          guideSource: join(dir, 'src', 'guide'),
          docsSource: join(dir, 'src', 'docs'),
          siteIndexHtml: readFileSync(join(dir, 'src', 'site', 'index.html'), 'utf8'),
          out: join(dir, 'out'),
          version: 'v',
          tag: 't',
        }),
      ).rejects.toThrow(/terminals\.md.*outline/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
