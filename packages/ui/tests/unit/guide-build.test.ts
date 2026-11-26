import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build script.
import { buildGuide } from '../../../../scripts/guide-build.mjs';

/**
 * 080 FR-001, FR-002, FR-005, FR-007, FR-026, research R1, R5, R17 and R21 — the guide builder turns `site/guide/*.md`
 * and the three reference pages into the site's `/guide/` tree, each reference split into a page per `##`.
 * Fixtures in `tests/fixtures/guide/`; no network.
 */

const FIXTURES = join(__dirname, '../fixtures/guide');
let root: string;
let out: string;

function copyFixtures(): { guideSource: string; docsSource: string; siteIndex: string } {
  cpSync(FIXTURES, join(root, 'src'), { recursive: true });
  return {
    guideSource: join(root, 'src', 'guide'),
    docsSource: join(root, 'src', 'docs'),
    siteIndex: join(root, 'src', 'site', 'index.html'),
  };
}

async function build(overrides: Record<string, unknown> = {}): Promise<{ pages: { url: string }[] }> {
  const sources = copyFixtures();
  return buildGuide({
    guideSource: sources.guideSource,
    docsSource: sources.docsSource,
    siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'),
    out,
    version: '1.0.0-beta3',
    tag: 'v1.0.0-beta3',
    ...overrides,
  });
}

/** Builds the fixtures after one source file is replaced; resolves to what `buildGuide` returns. */
async function buildWith(file: 'guide' | 'docs', name: string, text: string): Promise<{ nav: unknown[] }> {
  const sources = copyFixtures();
  writeFileSync(join(file === 'guide' ? sources.guideSource : sources.docsSource, name), text);
  return buildGuide({ ...sources, siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'), out, version: 'v', tag: 't' });
}

const page = (path: string): string => readFileSync(join(out, path), 'utf8');
const main = (path: string): string => {
  const html = page(path);
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'));
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-guide-'));
  out = join(root, 'out');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildGuide — pages', () => {
  it('writes the start page, each page, each reference and each reference section at directory URLs', async () => {
    await build();
    for (const path of [
      'guide/index.html',
      'guide/quick-start/index.html',
      'guide/terminals/index.html',
      'guide/reference/preferences/index.html',
      'guide/reference/preferences/general/index.html',
      'guide/reference/preferences/confirmations/index.html',
      'guide/reference/key-bindings/index.html',
      'guide/reference/key-bindings/view/index.html',
      'guide/reference/key-bindings/focus--zoom/index.html',
      'guide/reference/theme-settings/index.html',
      'guide/reference/theme-settings/main-panel--workspace/index.html',
    ]) {
      expect(existsSync(join(out, path)), path).toBe(true);
    }
  });

  it("gives headings GitHub's slugs, and a keyed section its key as its id, in all three references", async () => {
    await build();
    expect(page('guide/terminals/index.html')).toContain('id="open-a-terminal"');
    expect(page('guide/reference/preferences/general/index.html')).toContain('id="window.nativeWayland"');
    expect(page('guide/reference/preferences/general/index.html')).toContain('id="general"');
    expect(page('guide/reference/key-bindings/view/index.html')).toContain('id="help.open"');
    expect(page('guide/reference/key-bindings/focus--zoom/index.html')).toContain('id="zoom.in"');
    expect(page('guide/reference/theme-settings/main-panel--workspace/index.html')).toContain('id="colours.appBg"');
  });

  it("drops a reference page's breadcrumb line", async () => {
    await build();
    expect(page('guide/reference/preferences/index.html')).not.toContain('› Preferences');
  });
});

describe('buildGuide — reference sections (FR-026, R17)', () => {
  it('builds each ## of a reference into a page holding only that section', async () => {
    await build();
    const general = main('guide/reference/preferences/general/index.html');
    expect(general).toContain('id="window.nativeWayland"');
    expect(general).not.toContain('id="confirm.close"');
    expect(general).not.toContain('Every setting, by the page');
    const confirmations = main('guide/reference/preferences/confirmations/index.html');
    expect(confirmations).toContain('id="confirm.close"');
    expect(confirmations).not.toContain('id="window.nativeWayland"');
  });

  it("gives the reference's own URL its intro and a list of its section pages", async () => {
    await build();
    const index = main('guide/reference/preferences/index.html');
    expect(index).toContain('Every setting, by the page');
    expect(index).toContain('href="/guide/reference/preferences/general/"');
    expect(index).toContain('href="/guide/reference/preferences/confirmations/"');
    expect(index).not.toContain('id="window.nativeWayland"');
  });

  it('assigns ids across the whole reference first, so a repeated heading keeps its GitHub suffix', async () => {
    await build();
    expect(page('guide/reference/preferences/general/index.html')).toContain('id="window"');
    expect(page('guide/reference/preferences/confirmations/index.html')).toContain('id="window-1"');
  });

  it("titles a section page with its heading and its reference's title", async () => {
    await build();
    expect(page('guide/reference/key-bindings/focus--zoom/index.html')).toContain(
      '<title>Focus &amp; Zoom · Key bindings reference · throng guide</title>',
    );
  });

  it('shows where a page sits above its heading: the guide, its reference, then the page (FR-068)', async () => {
    await build();
    const trail = (path: string): string => {
      const html = main(path);
      return html.slice(html.indexOf('<nav class="page-trail"'), html.indexOf('</nav>') + 6);
    };
    const section = trail('guide/reference/key-bindings/focus--zoom/index.html');
    expect(section).toContain('aria-label="Breadcrumb"');
    expect(section).toContain('data-pagefind-ignore');
    expect(section).toMatch(
      /<a href="\/guide\/">Guide<\/a>[\s\S]*<a href="\/guide\/reference\/key-bindings\/">Key bindings reference<\/a>[\s\S]*<span aria-current="page">Focus &amp; Zoom<\/span>/,
    );
    expect(main('guide/reference/key-bindings/focus--zoom/index.html').indexOf('page-trail')).toBeLessThan(
      main('guide/reference/key-bindings/focus--zoom/index.html').search(/<h[1-6][ >]/),
    );
    expect(trail('guide/terminals/index.html')).toMatch(/<a href="\/guide\/">Guide<\/a>[\s\S]*<span aria-current="page">Terminals<\/span>/);
    // The start page is the guide itself: nothing above it to show.
    expect(main('guide/index.html')).not.toContain('page-trail');
  });

  it('refuses two ## sections with one slug, naming the file', async () => {
    const prefs = readFileSync(join(FIXTURES, 'docs', 'preferences.md'), 'utf8');
    await expect(buildWith('docs', 'preferences.md', `${prefs}\n## General\n\nAgain.\n`)).rejects.toThrow(
      /preferences\.md.*general/,
    );
  });

  it('leaves out a reference whose file is absent', async () => {
    const sources = copyFixtures();
    rmSync(join(sources.docsSource, 'theme-settings.md'));
    const result = await buildGuide({
      ...sources,
      siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'),
      out,
      version: 'v',
      tag: 't',
    });
    expect(result.nav.map((p: { title: string }) => p.title)).not.toContain('Theme settings reference');
    expect(existsSync(join(out, 'guide', 'reference', 'theme-settings'))).toBe(false);
  });
});

describe('buildGuide — navigation (FR-026)', () => {
  const refItem = (html: string, title: string): string => {
    const start = html.indexOf(`<summary>${title}</summary>`);
    const open = html.lastIndexOf('<details', start);
    return html.slice(open, html.indexOf('</details>', start));
  };

  it("expands a reference on its own pages, and marks the current section", async () => {
    await build();
    const html = page('guide/reference/preferences/general/index.html');
    const prefs = refItem(html, 'Preferences reference');
    expect(prefs).toMatch(/^<details class="guide-nav__ref" open>/);
    expect(prefs).toContain('<a href="/guide/reference/preferences/general/" aria-current="page">General</a>');
    expect(prefs).toContain('<a href="/guide/reference/preferences/confirmations/">Confirmations</a>');
    expect(refItem(html, 'Key bindings reference')).toMatch(/^<details class="guide-nav__ref">/);
  });

  it("expands a reference on its own URL too, marking that page", async () => {
    await build();
    const prefs = refItem(page('guide/reference/preferences/index.html'), 'Preferences reference');
    expect(prefs).toMatch(/^<details class="guide-nav__ref" open>/);
    expect(prefs).toContain('<a href="/guide/reference/preferences/" aria-current="page">');
  });
});

describe('buildGuide — screenshots open enlarged (FR-036)', () => {
  it("wraps each guide image in the home page's zoom link to the image itself", async () => {
    const sources = copyFixtures();
    mkdirSync(join(sources.guideSource, 'images', 'quick-start'), { recursive: true });
    writeFileSync(join(sources.guideSource, 'images', 'quick-start', 'shot.png'), 'png');
    writeFileSync(
      join(sources.guideSource, 'quick-start.md'),
      '---\ntitle: Quick start\norder: 1\n---\n\n![The window](images/quick-start/shot.png)\n',
    );
    await buildGuide({ ...sources, siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'), out, version: 'v', tag: 't' });
    expect(main('guide/quick-start/index.html')).toMatch(
      /<a class="zoom" href="\/guide\/images\/quick-start\/shot\.png" aria-label="Enlarge the screenshot: The window"><img src="\/guide\/images\/quick-start\/shot\.png" alt="The window"[^>]*><\/a>/,
    );
  });
});

describe('buildGuide — screenshots load lazily (FR-060)', () => {
  it("gives each image the home page's loading=lazy and its own width and height", async () => {
    const sources = copyFixtures();
    mkdirSync(join(sources.guideSource, 'images', 'quick-start'), { recursive: true });
    // A PNG's signature and IHDR chunk: 1600 × 900. The builder reads no further than that.
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    writeFileSync(join(sources.guideSource, 'images', 'quick-start', 'shot.png'), png);
    writeFileSync(
      join(sources.guideSource, 'quick-start.md'),
      '---\ntitle: Quick start\norder: 1\n---\n\n![The window](images/quick-start/shot.png)\n',
    );
    await buildGuide({ ...sources, siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'), out, version: 'v', tag: 't' });
    const img = /<img [^>]*>/.exec(main('guide/quick-start/index.html'))?.[0] ?? '';
    expect(img).toContain('loading="lazy"');
    expect(img).toContain('width="1600"');
    expect(img).toContain('height="900"');
  });
});

describe('buildGuide — sections (FR-059)', () => {
  it('draws a horizontal rule before every section heading but the first, and none after the last', async () => {
    const sources = copyFixtures();
    writeFileSync(
      join(sources.guideSource, 'quick-start.md'),
      '---\ntitle: Quick start\norder: 1\n---\n\n# Quick start\n\nIntro.\n\n## One\n\n**Cog › One**\n\nFirst.\n\n## Two\n\n**Cog › Two**\n\nSecond.\n',
    );
    await buildGuide({ ...sources, siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'), out, version: 'v', tag: 't' });
    const html = main('guide/quick-start/index.html');
    expect(html.match(/<hr>/g)?.length).toBe(2);
    expect(html).toMatch(/<hr>\s*<h2 id="one"/);
    expect(html).toMatch(/<hr>\s*<h2 id="two"/);
    expect(html.trimEnd()).not.toMatch(/<hr>\s*$/);
  });

  it("still keys a reference section by its key when a breadcrumb comes first", async () => {
    const sources = copyFixtures();
    writeFileSync(
      join(sources.docsSource, 'preferences.md'),
      '# Preferences\n\nIntro.\n\n## General\n\n### Window\n\n#### Use native Wayland (Linux only)\n\n**Cog › Settings › General › Window**\n\n`window.nativeWayland`\n\nRun directly on Wayland.\n',
    );
    await buildGuide({ ...sources, siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'), out, version: 'v', tag: 't' });
    expect(main('guide/reference/preferences/general/index.html')).toContain('id="window.nativeWayland"');
  });
});

describe('buildGuide — callouts (D2, R21)', () => {
  const callouts = [
    '---\ntitle: Quick start\norder: 1\n---\n',
    '> [!NOTE]\n> Projects keep their own terminals.\n',
    '> [!TIP]\n> Drag a folder in.\n',
    '> [!WARNING]\n> Closing a project stops its shells.\n',
    '> A plain quote.\n',
  ].join('\n');

  it.each([
    ['note', 'Note', 'Projects keep their own terminals.'],
    ['tip', 'Tip', 'Drag a folder in.'],
    ['warning', 'Warning', 'Closing a project stops its shells.'],
  ])('renders [!%s] as a callout with its title, without the marker', async (kind, title, text) => {
    await buildWith('guide', 'quick-start.md', callouts);
    const html = main('guide/quick-start/index.html');
    expect(html).toMatch(
      new RegExp(`<aside class="callout callout--${kind}">\\s*<p class="callout__title">${title}</p>\\s*<p>${text}</p>\\s*</aside>`),
    );
    expect(html).not.toContain(`[!${kind.toUpperCase()}]`);
  });

  it('leaves a plain blockquote a quote', async () => {
    await buildWith('guide', 'quick-start.md', callouts);
    expect(main('guide/quick-start/index.html')).toMatch(/<blockquote>\s*<p>A plain quote\.<\/p>\s*<\/blockquote>/);
  });
});

describe('buildGuide — links', () => {
  it('rewrites guide, reference and repository links for the site', async () => {
    await build();
    const start = page('guide/index.html');
    expect(start).toContain('href="/guide/quick-start/"');
    expect(start).toContain('href="/guide/terminals/#open-a-terminal"');
    expect(start).toContain('href="/guide/reference/preferences/"');
    expect(start).toContain('href="https://github.com/Bidthedog/throng/blob/v1.0.0-beta3/docs/installation.md"');
    // A reference page's own link to an unpublished doc goes to GitHub at the tag too.
    expect(page('guide/reference/preferences/general/index.html')).toContain(
      'href="https://github.com/Bidthedog/throng/blob/v1.0.0-beta3/docs/linux.md#display"',
    );
  });

  it('sends a link to docs/<ref>.md#<id> to the section page holding the id', async () => {
    await build();
    const start = page('guide/index.html');
    expect(start).toContain('href="/guide/reference/preferences/general/#window.nativeWayland"');
    expect(start).toContain('href="/guide/reference/key-bindings/view/#view"');
    expect(start).toContain('href="/guide/reference/key-bindings/view/#help.open"');
    // A reference's links to its own ids cross to the section page holding them.
    expect(page('guide/reference/preferences/index.html')).toContain('href="/guide/reference/preferences/general/#general"');
    expect(page('guide/reference/preferences/confirmations/index.html')).toContain(
      'href="/guide/reference/preferences/general/#window.nativeWayland"',
    );
  });

  it('fails on a link to an id no reference page holds', async () => {
    await expect(
      buildWith('guide', 'quick-start.md', '---\ntitle: Quick start\norder: 1\n---\n\n[x](../docs/preferences.md#no-such-key)\n'),
    ).rejects.toThrow(/quick-start\.md.*no-such-key/);
  });

  it('fails on a link to a guide page that does not exist, naming the file', async () => {
    await expect(
      buildWith('guide', 'quick-start.md', '---\ntitle: Quick start\norder: 1\n---\n\n[x](nope.md)\n'),
    ).rejects.toThrow(/quick-start\.md.*nope\.md/);
  });

  it('fails on a link to an anchor the target lacks', async () => {
    await expect(
      buildWith('guide', 'quick-start.md', '---\ntitle: Quick start\norder: 1\n---\n\n[x](terminals.md#no-such-task)\n'),
    ).rejects.toThrow(/no-such-task/);
  });
});

describe('buildGuide — front matter', () => {
  it.each(['title', 'order'])('fails on a page missing %s, naming the file', async (field) => {
    const other = field === 'title' ? 'order: 1' : 'title: Quick start';
    await expect(buildWith('guide', 'quick-start.md', `---\n${other}\n---\n\nText.\n`)).rejects.toThrow(
      new RegExp(`quick-start\\.md.*${field}`),
    );
  });

  it.each([`'Quick: start'`, `"Quick: start"`])('reads a quoted title, %s, without its quotes', async (quoted) => {
    const result = await buildWith('guide', 'quick-start.md', `---\ntitle: ${quoted}\norder: 1\n---\n\nText.\n`);
    expect(result.nav.map((p) => (p as { title: string }).title)).toContain('Quick: start');
  });

  it('fails on two setting sections with one key', async () => {
    const prefs = readFileSync(join(FIXTURES, 'docs', 'preferences.md'), 'utf8');
    await expect(
      buildWith('docs', 'preferences.md', `${prefs}\n#### Again\n\n\`window.nativeWayland\`\n\nText.\n`),
    ).rejects.toThrow(/window\.nativeWayland/);
  });
});

describe('buildGuide — search engines (FR-041)', () => {
  const head = (path: string): string => {
    const html = page(path);
    return html.slice(0, html.indexOf('</head>'));
  };

  it("describes each page by its opening paragraph, with link-preview tags and the home page's icons", async () => {
    await build();
    const h = head('guide/terminals/index.html');
    expect(h).toContain('<meta name="description" content="Terminals run your shells.">');
    expect(h).toContain('<meta property="og:title" content="Terminals · throng guide">');
    expect(h).toContain('<meta property="og:description" content="Terminals run your shells.">');
    expect(h).toContain('<meta property="og:url" content="https://throng-ide.com/guide/terminals/">');
    expect(h).toContain('<meta property="og:image" content="https://throng-ide.com/assets/social-card.png">');
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(h).toContain('<link rel="canonical" href="https://throng-ide.com/guide/terminals/">');
    expect(h).toContain('<meta name="theme-color"');
    expect(h).toContain('<link rel="manifest" href="/site.webmanifest">');
    expect(h).toContain('<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">');
  });

  it('cuts a long opening paragraph to 160 characters at a word', async () => {
    const long = `${'word '.repeat(60).trim()}.`;
    await buildWith('guide', 'terminals.md', `---\ntitle: Terminals\norder: 2\n---\n\n# Terminals\n\n${long}\n\n## Open a terminal\n`);
    const content = head('guide/terminals/index.html').match(/<meta name="description" content="([^"]*)">/)?.[1] ?? '';
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).toMatch(/word…$/);
  });

  it("never describes a page by a paragraph inside one of its sections, such as a setting's key", async () => {
    await build();
    const content = head('guide/reference/preferences/general/index.html').match(/<meta name="description" content="([^"]*)">/)?.[1];
    expect(content).toBe('General · Preferences reference: the throng user guide.');
  });

  it('gives a reference section page a breadcrumb trail through its reference', async () => {
    await build();
    const ld = JSON.parse(
      head('guide/reference/preferences/general/index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? 'null',
    ) as { '@type': string; itemListElement: { position: number; name: string; item: string }[] };
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement.map((i) => [i.position, i.item])).toEqual([
      [1, 'https://throng-ide.com/'],
      [2, 'https://throng-ide.com/guide/'],
      [3, 'https://throng-ide.com/guide/reference/preferences/'],
      [4, 'https://throng-ide.com/guide/reference/preferences/general/'],
    ]);
  });
});

describe('buildGuide — sitemaps (FR-042)', () => {
  it('writes sitemap.xml with the home page, the sitemap page and every built page', async () => {
    const built = await build();
    const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(locs).toEqual([
      'https://throng-ide.com/',
      'https://throng-ide.com/sitemap/',
      ...built.pages.map((p) => `https://throng-ide.com${p.url}`),
    ]);
  });

  it('builds a sitemap page listing every page, references with their sections, outside the search index', async () => {
    await build();
    const html = page('sitemap/index.html');
    const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(body).toContain('<a href="/">throng</a>');
    expect(body).toContain('<a href="/guide/terminals/">Terminals</a>');
    expect(body).toMatch(/<a href="\/guide\/reference\/preferences\/">Preferences reference<\/a>\s*<ul>[\s\S]*?<a href="\/guide\/reference\/preferences\/general\/">General<\/a>/);
    expect(body).not.toContain('data-pagefind-body');
    expect(html).toContain('<link rel="canonical" href="https://throng-ide.com/sitemap/">');
    // FR-066 — the sitemap is the website's own page: no guide page list beside it.
    expect(html).not.toContain('class="guide-nav"');
  });
});

describe('buildGuide — what it returns', () => {
  it('reports every page and its ids, so the anchor checks can read them', async () => {
    const sources = copyFixtures();
    const result = await buildGuide({
      ...sources,
      siteIndexHtml: readFileSync(sources.siteIndex, 'utf8'),
      out,
      version: '1.0.0-beta3',
      tag: 'v1.0.0-beta3',
    });
    expect(result.ids.get('/guide/terminals/')).toContain('open-a-terminal');
    expect(result.ids.get('/guide/reference/preferences/general/')).toContain('window.nativeWayland');
    expect(result.ids.get('/guide/reference/preferences/')).not.toContain('window.nativeWayland');
    expect(result.nav.map((p: { title: string }) => p.title)).toEqual([
      'Intro',
      'Quick start',
      'Terminals',
      'Preferences reference',
      'Key bindings reference',
      'Theme settings reference',
    ]);
    const keys = result.nav.find((p: { title: string }) => p.title === 'Key bindings reference');
    expect(keys.sections).toEqual([
      { title: 'View', url: '/guide/reference/key-bindings/view/' },
      { title: 'Focus & Zoom', url: '/guide/reference/key-bindings/focus--zoom/' },
    ]);
  });
});
