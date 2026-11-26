/**
 * 080 FR-015, SC-005 — every link throng opens lands on a page and a section that exist in the built guide.
 *
 * Builds the real `site/guide/` and `docs/` with the site's own builder, then resolves against what it wrote: every
 * guide-map task, every setting's (?) link, the start page, every internal link on every page, and the navigation.
 * The builder already refuses a broken internal link; this proves the URLs the APP builds land too.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GUIDE_MAP,
  GUIDE_PAGES,
  KEYBINDINGS_METADATA,
  SETTINGS_METADATA,
  THEME_METADATA,
  helpUrl,
  keyBindingHelpUrl,
  settingHelpUrl,
  startPageUrl,
  themeTokenHelpUrl,
} from '@throng/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script with no type declarations
import { buildGuide } from '../../../../scripts/guide-build.mjs';

const ROOT = process.cwd();
const BASE = 'https://help.example.test/guide/';
let out: string;
let ids: Map<string, Set<string>>;
let nav: Array<{ title: string; url: string; sections?: Array<{ title: string; url: string }> }>;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'throng-guide-anchors-'));
  const result = await buildGuide({
    guideSource: join(ROOT, 'site', 'guide'),
    repoRoot: ROOT,
    docsSource: join(ROOT, 'docs'),
    siteIndexHtml: readFileSync(join(ROOT, 'site', 'index.html'), 'utf8'),
    out,
    version: 'test',
    tag: 'master',
  });
  ids = result.ids;
  nav = result.nav;
});
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

/** The site path and id a URL under BASE (or a site-absolute href) points at, and whether they exist. */
function lands(url: string): boolean {
  const u = new URL(url, 'https://help.example.test');
  const path = u.pathname;
  const anchor = decodeURIComponent(u.hash.slice(1));
  // A link to a file, such as a screenshot's zoom link, lands when the build wrote that file.
  if (!path.endsWith('/') && anchor === '') return existsSync(join(out, path));
  const pageIds = ids.get(path);
  return pageIds !== undefined && (anchor === '' || pageIds.has(anchor));
}

describe('the built guide has every section throng links to (080 FR-015, SC-005)', () => {
  it('lands the start page', () => {
    expect(lands(startPageUrl(BASE))).toBe(true);
  });

  it('lands every guide-map task', () => {
    const broken = GUIDE_MAP.map((t) => helpUrl({ page: t.page, anchor: t.anchor }, { base: BASE })).filter(
      (u) => !lands(u),
    );
    expect(broken).toEqual([]);
  });

  it("lands every setting's (?) link on its own section page (FR-026)", () => {
    const broken = SETTINGS_METADATA.map((d) => settingHelpUrl(d.key, BASE)).filter((u) => !lands(u));
    expect(broken).toEqual([]);
  });

  it("lands every key binding's (?) link on its own section page (FR-026)", () => {
    const broken = KEYBINDINGS_METADATA.map((d) => keyBindingHelpUrl(d.key, BASE)).filter((u) => !lands(u));
    expect(broken).toEqual([]);
  });

  it("lands every theme setting's (?) link on its own section page", () => {
    const broken = THEME_METADATA.map((d) => themeTokenHelpUrl(d.key, BASE)).filter((u) => !lands(u));
    expect(broken).toEqual([]);
  });

  it('lands every internal link on every built page', () => {
    const broken: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'index.html') {
          for (const m of readFileSync(p, 'utf8').matchAll(/href="(\/guide\/[^"]*)"/g)) {
            if (!lands(m[1] as string)) broken.push(`${p.slice(out.length)} → ${m[1]}`);
          }
        }
      }
    };
    walk(join(out, 'guide'));
    expect(broken).toEqual([]);
  });

  it('lists every guide page in the navigation, in order', () => {
    const titles = nav.map((n) => n.title);
    expect(titles.slice(0, GUIDE_PAGES.length)).toEqual(GUIDE_PAGES.map((p) => p.title));
  });

  it('lists the three references after the guide pages, each with a landing section page per ##', () => {
    const refs = nav.slice(GUIDE_PAGES.length);
    expect(refs.map((r) => r.url)).toEqual([
      '/guide/reference/preferences/',
      '/guide/reference/key-bindings/',
      '/guide/reference/theme-settings/',
    ]);
    for (const ref of refs) {
      expect(ref.sections?.length, ref.url).toBeGreaterThan(0);
      expect(ref.sections?.filter((s) => !lands(s.url)) ?? []).toEqual([]);
    }
  });
});
