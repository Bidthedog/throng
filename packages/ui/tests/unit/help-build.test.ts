/**
 * 080 FR-049 — the guide that ships with throng: the same builder over the same source, the site assets its pages
 * load, and a Pagefind index, written to one folder the app's Help window serves. The home page is not shipped:
 * its links leave the Help window for the website (FR-050).
 *
 * Layer: unit — the real builder and the real Pagefind over the test fixtures, into a temp folder.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildHelpBundle } from '../../../../scripts/help-build.mjs';

const FIXTURES = join(__dirname, '../fixtures/guide');
let out: string;

beforeAll(async () => {
  out = join(mkdtempSync(join(tmpdir(), 'throng-help-bundle-')), 'help');
  await buildHelpBundle({
    out,
    version: '1.0.0-beta3',
    siteSource: join(__dirname, '../../../../site'),
    guideSource: join(FIXTURES, 'guide'),
    docsSource: join(FIXTURES, 'docs'),
    repoRoot: FIXTURES,
  });
}, 60_000);
afterAll(() => rmSync(join(out, '..'), { recursive: true, force: true }));

describe('buildHelpBundle (FR-049)', () => {
  it('writes the guide and its references, but not the website\'s sitemap (FR-066)', () => {
    for (const page of ['guide/index.html', 'guide/terminals/index.html', 'guide/reference/preferences/general/index.html']) {
      expect(existsSync(join(out, page)), page).toBe(true);
    }
    expect(existsSync(join(out, 'sitemap')), 'sitemap page').toBe(false);
    expect(existsSync(join(out, 'sitemap.xml')), 'sitemap.xml').toBe(false);
  });

  it('carries the stylesheet, script, fonts and icons the pages load, but not the home page or its screenshots', () => {
    for (const file of ['assets/site.css', 'assets/site.js', 'assets/fonts/schibsted-grotesk-latin-var.woff2', 'assets/fonts/fragment-mono-latin-400.woff2', 'favicon.ico']) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    expect(existsSync(join(out, 'index.html'))).toBe(false);
    expect(existsSync(join(out, 'assets', 'shots'))).toBe(false);
  });

  it("stamps the app's own version", () => {
    expect(readFileSync(join(out, 'guide', 'terminals', 'index.html'), 'utf8')).toContain('data-site-version>v1.0.0-beta3<');
  });

  it('indexes the guide for search, offline', () => {
    expect(existsSync(join(out, 'pagefind', 'pagefind.js'))).toBe(true);
    expect(existsSync(join(out, 'pagefind', 'pagefind-ui.js'))).toBe(true);
  });
});
