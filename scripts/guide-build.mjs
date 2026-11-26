// Builds the user guide into the site (080 FR-001, FR-002, FR-005, FR-007, FR-026, FR-033; research R1, R5,
// R12, R17, R21).
//
//   site/guide/<page>.md       → /guide/<page>/                  (site/guide/index.md → /guide/)
//   docs/<ref>.md              → /guide/reference/<ref>/          the intro, and a list of its sections
//   docs/<ref>.md, each `##`   → /guide/reference/<ref>/<slug>/   that section alone
//   site/guide/images/**       → /guide/images/**
//
// <ref> is preferences, key-bindings or theme-settings; a reference whose file is absent is left out.
// markdown-it renders every page; `guide-template.mjs` wraps it in the home page's own header and footer.
// The build refuses, naming the file, on: a page missing `title` or `order`, a page marked `status: outline`,
// a link to a guide or reference page that does not exist or to an anchor no page holds, two keyed sections
// with one key, and two `##` sections of a reference with one slug. Every heading gets GitHub's slug,
// assigned across the whole source file before it is split (so a link that works on GitHub works here); a
// keyed section of a reference gets its KEY as its id, read from the code span on the line after its heading,
// so a reworded heading never moves the (?) link that targets it. A GitHub alert (`> [!NOTE]`, `> [!TIP]`,
// `> [!WARNING]`) renders as a titled callout.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import MarkdownIt from 'markdown-it';

import { SITE, renderPage, templateFrom } from './guide-template.mjs';

const REPO_URL = 'https://github.com/Bidthedog/throng/blob';
/** A setting key, action id or theme token: `window.nativeWayland`, `zoom.in`, `colours.appBg`. */
const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/;
const REFERENCES = [
  { file: 'preferences.md', url: '/guide/reference/preferences/', title: 'Preferences reference' },
  { file: 'key-bindings.md', url: '/guide/reference/key-bindings/', title: 'Key bindings reference' },
  { file: 'theme-settings.md', url: '/guide/reference/theme-settings/', title: 'Theme settings reference' },
];
const CALLOUT = /^\[!(NOTE|TIP|WARNING)\][ \t]*(?:\n|$)/i;

/**
 * GitHub's heading anchor: lower-cased, punctuation dropped (hyphens kept), spaces to hyphens. The same rule as
 * `referenceSlug` in @throng/core, which this plain .mjs cannot import; `guide-slug.test.ts` holds them together.
 */
export function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function frontMatter(source, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  const fields = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
      // A YAML value with a colon in it has to be quoted; the quotes are not part of the value.
      if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const required of ['title', 'order']) {
    if (fields[required] === undefined || fields[required] === '') {
      throw new Error(`${file}: front matter has no ${required}`);
    }
  }
  // FR-033 — no guide page ships as an outline.
  if (fields.status === 'outline') throw new Error(`${file}: is marked status: outline, and no guide page may ship as one`);
  const order = Number(fields.order);
  if (!Number.isInteger(order)) throw new Error(`${file}: front matter order "${fields.order}" is not a whole number`);
  return { fields: { ...fields, order }, body: match ? source.slice(match[0].length) : source };
}

/** A reference page loses its breadcrumb line; the site's navigation replaces it. */
function dropBreadcrumb(source) {
  const lines = source.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first >= 0 && lines[first].startsWith('[throng](')) lines.splice(first, 1);
  return lines.join('\n');
}

function headingText(inline) {
  return (inline.children ?? []).map((t) => (t.type === 'text' || t.type === 'code_inline' ? t.content : '')).join('');
}

/** FR-059 — a paragraph that is wholly bold: a section's breadcrumb. */
function isBreadcrumb(tokens, at) {
  const all = tokens[at]?.type === 'paragraph_open' ? tokens[at + 1]?.children : undefined;
  // markdown-it brackets the strong run with empty text tokens.
  const kids = (all ?? []).filter((t) => !(t.type === 'text' && t.content === ''));
  return kids[0]?.type === 'strong_open' && kids.at(-1)?.type === 'strong_close';
}

/** FR-059 — a horizontal rule before every section heading (h2 to h4) but the page's first heading. */
function rulesBetweenSections(tokens) {
  const Token = tokens[0]?.constructor;
  if (!Token) return tokens;
  const out = [];
  let seenHeading = false;
  for (const token of tokens) {
    if (token.type === 'heading_open') {
      if (seenHeading && ['h2', 'h3', 'h4'].includes(token.tag)) {
        const hr = new Token('hr', 'hr', 0);
        hr.block = true;
        hr.markup = '---';
        out.push(hr);
      }
      seenHeading = true;
    }
    out.push(token);
  }
  return out;
}

/** Assigns every heading of a whole source file its id. */
function assignIds(tokens, source) {
  const seen = new Map();
  const keyed = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'heading_open') continue;
    let id;
    if (source.keyed) {
      // FR-059 — a breadcrumb paragraph may sit between the heading and the key.
      const at = isBreadcrumb(tokens, i + 3) ? i + 6 : i + 3;
      const p = tokens[at];
      const inline = tokens[at + 1];
      const only = inline?.children?.length === 1 ? inline.children[0] : undefined;
      if (p?.type === 'paragraph_open' && only?.type === 'code_inline' && KEY.test(only.content)) {
        id = only.content;
        if (keyed.has(id)) throw new Error(`${source.file}: two sections for ${id}`);
        keyed.add(id);
      }
    }
    if (id === undefined) {
      const base = slug(headingText(tokens[i + 1]));
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      id = n === 0 ? base : `${base}-${n}`;
    }
    tokens[i].attrSet('id', id);
  }
}

const idsIn = (tokens) => new Set(tokens.filter((t) => t.type === 'heading_open').map((t) => t.attrGet('id')));

/** D2, R21 — a blockquote opening with a GitHub alert marker becomes `<aside class="callout callout--…">`. */
function callouts(tokens) {
  const Token = tokens[0]?.constructor;
  const open = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'blockquote_close') {
      if (open.pop()) token.tag = 'aside';
      continue;
    }
    if (token.type !== 'blockquote_open') continue;
    const inline = tokens[i + 2];
    const match = tokens[i + 1]?.type === 'paragraph_open' && inline?.type === 'inline' ? CALLOUT.exec(inline.content) : null;
    open.push(match !== null);
    if (!match) continue;
    const kind = match[1].toLowerCase();
    token.tag = 'aside';
    token.attrSet('class', `callout callout--${kind}`);
    const titleOpen = new Token('paragraph_open', 'p', 1);
    titleOpen.attrSet('class', 'callout__title');
    const titleText = new Token('text', '', 0);
    titleText.content = kind[0].toUpperCase() + kind.slice(1);
    const title = new Token('inline', '', 0);
    title.children = [titleText];
    const titleTokens = [titleOpen, title, new Token('paragraph_close', 'p', -1)];
    const lineBreak = inline.children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
    if (lineBreak < 0) {
      // The marker is the whole paragraph; the callout's text follows in paragraphs of its own.
      tokens.splice(i + 1, 3, ...titleTokens);
    } else {
      inline.children.splice(0, lineBreak + 1);
      inline.content = inline.content.slice(match[0].length);
      tokens.splice(i + 1, 0, ...titleTokens);
    }
    i += 3;
  }
}

/**
 * FR-026, R17 — a reference becomes its intro (everything before the first `##`) at its own URL, and one page per
 * `##` section below it. Ids were assigned across the whole file first.
 */
function splitReference(source) {
  const starts = source.tokens.flatMap((t, i) => (t.type === 'heading_open' && t.tag === 'h2' ? [i] : []));
  const sections = starts.map((start, n) => {
    const tokens = source.tokens.slice(start, starts[n + 1] ?? source.tokens.length);
    const heading = headingText(tokens[1]);
    return { heading, url: `${source.url}${slug(heading)}/`, tokens };
  });
  const urls = new Set();
  for (const s of sections) {
    if (urls.has(s.url)) throw new Error(`${source.file}: two ## sections share the slug ${slug(s.heading)}`);
    urls.add(s.url);
  }
  const intro = {
    url: source.url,
    title: source.title,
    tokens: source.tokens.slice(0, starts[0] ?? source.tokens.length),
    sections: sections.map((s) => ({ title: s.heading, url: s.url })),
  };
  return [
    intro,
    ...sections.map((s) => ({ url: s.url, title: `${s.heading} · ${source.title}`, heading: s.heading, tokens: s.tokens })),
  ];
}

const isWithin = (path, dir) => path === dir || path.startsWith(dir + sep);

/** A PNG's width and height from its IHDR chunk, or `null` for anything else. */
function pngSize(path) {
  let head;
  try {
    head = readFileSync(path).subarray(0, 24);
  } catch {
    return null;
  }
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47 || head.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** FR-060 — a screenshot loads as the home page's do: lazily, its box reserved by its own size. */
function lazyImage(token, path) {
  token.attrSet('loading', 'lazy');
  const size = pngSize(path);
  if (size) {
    token.attrSet('width', String(size.width));
    token.attrSet('height', String(size.height));
  }
}

/** Rewrites each link for the site and refuses one that points at a missing page or anchor. */
function rewriteLinks(tokens, source, ctx) {
  const visit = (list) => {
    for (const token of list) {
      if (token.children) visit(token.children);
      if (token.type !== 'link_open' && token.type !== 'image') continue;
      const attr = token.type === 'image' ? 'src' : 'href';
      const target = token.attrGet(attr);
      if (target === null || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [pathPart, anchor] = target.split('#');
      let to;
      if (pathPart === '') {
        to = source;
      } else {
        const absolutePath = resolve(dirname(source.path), pathPart);
        to = ctx.byPath.get(absolutePath);
        if (!to) {
          if (isWithin(absolutePath, ctx.guideSource)) {
            if (absolutePath.endsWith('.md')) {
              throw new Error(`${source.file}: links to ${pathPart}, which is not a guide page`);
            }
            token.attrSet(attr, `/guide/${relative(ctx.guideSource, absolutePath).split(sep).join('/')}`);
            if (token.type === 'image') lazyImage(token, absolutePath);
          } else {
            const rel = relative(ctx.repoRoot, absolutePath).split(sep).join('/');
            token.attrSet(attr, `${REPO_URL}/${ctx.tag}/${rel}${anchor ? `#${anchor}` : ''}`);
          }
          continue;
        }
      }
      if (!anchor) {
        token.attrSet(attr, to.url);
        continue;
      }
      // The anchor may sit on any page the target file was built into.
      const url = to.idToUrl.get(anchor);
      if (url === undefined) throw new Error(`${source.file}: links to ${target}, and no page built from it has #${anchor}`);
      token.attrSet(attr, `${url}#${anchor}`);
    }
  };
  visit(tokens);
}

/** The intro's generated list of its section pages. */
/** FR-041 — a page's description is its opening paragraph as plain text, cut at a word to 160 characters. */
function describe(md, page) {
  // Only the page's own opening: a paragraph after its second heading belongs to a section (a setting, a task).
  const headings = page.tokens.flatMap((t, i) => (t.type === 'heading_open' ? [i] : []));
  const end = headings[1] ?? page.tokens.length;
  const at = page.tokens.findIndex((t, i) => i < end && t.type === 'paragraph_open' && !isBreadcrumb(page.tokens, i));
  const text = at < 0 ? '' : md.renderer.renderInlineAsText(page.tokens[at + 1].children ?? [], md.options, {}).replace(/\s+/g, ' ').trim();
  if (text === '') return `${page.title}: the throng user guide.`;
  if (text.length <= 160) return text;
  const cut = text.slice(0, 159);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.]+$/, '')}…`;
}

/** FR-041 — the trail from the home page to a page: the guide, then its reference for a reference page. */
function breadcrumbsFor(page) {
  const trail = [{ name: 'throng', url: '/' }, { name: 'Guide', url: '/guide/' }];
  if (page.url === '/guide/') return trail;
  if (page.source.reference) {
    trail.push({ name: page.source.title, url: page.source.url });
    if (page.url !== page.source.url) trail.push({ name: page.heading, url: page.url });
  } else trail.push({ name: page.title, url: page.url });
  return trail;
}

/** FR-042 — sitemap.xml: the home page, the sitemap page, then every built page, by canonical URL. */
function sitemapXml(urls) {
  const entries = urls.map((u) => `  <url>\n    <loc>${SITE}${u}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** FR-042 — the sitemap page's body: the home page, the guide's pages, each reference with its sections. */
function sitemapBody(nav) {
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = (p) => `<a href="${p.url}">${escape(p.title)}</a>`;
  const items = nav
    .map((p) => (p.sections ? `<li>${a(p)}\n<ul>\n${p.sections.map((s) => `<li>${a(s)}</li>`).join('\n')}\n</ul></li>` : `<li>${a(p)}</li>`))
    .join('\n');
  return `<h1 id="sitemap">Sitemap</h1>\n<ul class="sitemap">\n<li><a href="/">throng</a></li>\n${items}\n</ul>\n`;
}

function sectionList(sections) {
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = sections.map((s) => `<li><a href="${s.url}">${escape(s.title)}</a></li>`).join('\n');
  return `<ul class="guide-sections">\n${items}\n</ul>\n`;
}

/**
 * Builds the guide and the references into `<out>/guide/`. Returns each page's ids by URL and the navigation
 * (each reference with its section pages), for the checks that compare them with the guide map.
 */
export async function buildGuide({ guideSource, docsSource, siteIndexHtml, out, version, tag, repoRoot, sitemap = true }) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  // FR-036 — every screenshot is the home page's zoom link to the image itself: site.js opens it in the enlarge
  // modal, and without script the click opens the image.
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const alt = token.children ? self.renderInlineAsText(token.children, options, env) : token.content;
    const label = md.utils.escapeHtml(`Enlarge the screenshot: ${alt}`);
    return `<a class="zoom" href="${md.utils.escapeHtml(token.attrGet('src'))}" aria-label="${label}">${image(tokens, idx, options, env, self)}</a>`;
  };
  const root = repoRoot ?? dirname(guideSource);

  const guidePages = readdirSync(guideSource)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const path = join(guideSource, f);
      const { fields, body } = frontMatter(readFileSync(path, 'utf8'), f);
      const slugName = basename(f, '.md');
      return {
        file: f,
        path,
        url: slugName === 'index' ? '/guide/' : `/guide/${slugName}/`,
        title: fields.title,
        order: fields.order,
        text: body,
        keyed: false,
        reference: false,
      };
    })
    .sort((a, b) => a.order - b.order);
  const references = REFERENCES.filter((r) => existsSync(join(docsSource, r.file))).map((r) => ({
    file: r.file,
    path: join(docsSource, r.file),
    url: r.url,
    title: r.title,
    text: dropBreadcrumb(readFileSync(join(docsSource, r.file), 'utf8')),
    keyed: true,
    reference: true,
  }));
  const sources = [...guidePages, ...references];

  // Pass 1: parse every file, assign its ids, and split each reference, so pass 2 can resolve every link.
  const outputs = [];
  for (const source of sources) {
    source.tokens = md.parse(source.text, {});
    callouts(source.tokens);
    assignIds(source.tokens, source);
    const built = source.reference
      ? splitReference(source)
      : [{ url: source.url, title: source.title, tokens: source.tokens }];
    source.idToUrl = new Map();
    for (const page of built) {
      page.source = source;
      page.ids = idsIn(page.tokens);
      for (const id of page.ids) source.idToUrl.set(id, page.url);
      outputs.push(page);
    }
    source.sections = built[0].sections;
  }
  const ctx = { byPath: new Map(sources.map((s) => [s.path, s])), guideSource, repoRoot: root, tag };
  for (const source of sources) rewriteLinks(source.tokens, source, ctx);

  const nav = sources.map((s) => (s.reference ? { title: s.title, url: s.url, sections: s.sections } : { title: s.title, url: s.url }));
  const template = templateFrom(siteIndexHtml, version);
  for (const page of outputs) {
    let bodyHtml = md.renderer.render(rulesBetweenSections(page.tokens), md.options, {});
    if (page.sections) bodyHtml += sectionList(page.sections);
    const html = renderPage({ template, nav, page, bodyHtml, description: describe(md, page), breadcrumbs: breadcrumbsFor(page) });
    const dir = join(out, page.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
  }
  // FR-066 — the sitemap page and sitemap.xml are the website's: the guide shipped with the app leaves them out.
  if (sitemap) writeSitemap({ out, template, nav, outputs });
  const images = join(guideSource, 'images');
  if (existsSync(images)) cpSync(images, join(out, 'guide', 'images'), { recursive: true, filter: (path) => !path.endsWith('screens.json') }); // FR-067's map is the repo's, not the site's

  return {
    ids: new Map(outputs.map((p) => [p.url, p.ids])),
    nav,
    pages: outputs.map((p) => ({ file: p.source.file, url: p.url, title: p.title })),
  };
}

/** FR-042 — the sitemap page at /sitemap/ (no guide page list beside it, FR-066) and sitemap.xml. */
function writeSitemap({ out, template, nav, outputs }) {
  const sitemap = { url: '/sitemap/', title: 'Sitemap' };
  mkdirSync(join(out, 'sitemap'), { recursive: true });
  writeFileSync(
    join(out, 'sitemap', 'index.html'),
    renderPage({
      template,
      nav: null,
      page: sitemap,
      bodyHtml: sitemapBody(nav),
      description: 'Every page on throng-ide.com: the home page, the user guide and its three references.',
      breadcrumbs: [{ name: 'throng', url: '/' }, { name: 'Sitemap', url: sitemap.url }],
      search: false,
    }),
  );
  writeFileSync(join(out, 'sitemap.xml'), sitemapXml(['/', sitemap.url, ...outputs.map((p) => p.url)]));
}
