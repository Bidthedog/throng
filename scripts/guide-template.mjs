// The guide's page template (080 FR-002a, FR-002b, FR-002c). The header and footer are LIFTED from the
// home page, `site/index.html`, at build time, so the guide and the home page share one header, one footer
// and one stylesheet by construction rather than by a copy that drifts. Only three things change in them:
// same-page anchors become absolute (the guide lives under /guide/), the version label is filled, and the
// header gains the search field, between the brand and the site nav (FR-029: brand, search, nav, version).

const VERSION_SLOT = /(data-site-version>)(<\/(?:span|p)>)/g;
const SITE_NAV = '<nav aria-label="Site">';

/** One element's outer HTML, from its opening tag to the first matching close. */
function lift(html, open, close, what) {
  const start = html.search(open);
  if (start < 0) throw new Error(`site/index.html has no ${what}; the guide wears the home page's own`);
  return html.slice(start, html.indexOf(close, start) + close.length);
}

const absolute = (html) => html.replace(/href="#/g, 'href="/#');
const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The home page's header and footer, ready for a guide page. */
export function templateFrom(siteIndexHtml, version) {
  const label = `v${version}`;
  const home = absolute(lift(siteIndexHtml, /<header class="top">/, '</header>', 'header'));
  if (!home.includes(SITE_NAV)) throw new Error('site/index.html has no <nav aria-label="Site"> in its header');
  const header = home
    .replace(SITE_NAV, `<div class="guide-search" id="search"></div>${SITE_NAV}`)
    .replace(VERSION_SLOT, (_m, open, close) => `${open}${escape(label)}${close}`);
  const footer = absolute(lift(siteIndexHtml, /<footer[\s>]/, '</footer>', 'footer')).replace(
    VERSION_SLOT,
    (_m, open, close) => `${open}${escape(label)}${close}`,
  );
  return { header, footer };
}

/** Fills the home page's own version slots, for the copy of `index.html` the site serves. */
export function stampVersion(siteIndexHtml, version) {
  return siteIndexHtml.replace(VERSION_SLOT, (_m, open, close) => `${open}${escape(`v${version}`)}${close}`);
}

const link = (p, current, title = p.title) =>
  `<li><a href="${p.url}"${p.url === current ? ' aria-current="page"' : ''}>${escape(title)}</a></li>`;

/**
 * The guide's pages in order, then each reference as an expandable item listing its own URL and its section
 * pages, open on any of those pages (FR-026).
 */
function navigation(nav, current) {
  const items = nav
    .map((p) => {
      if (!p.sections) return link(p, current);
      const here = p.url === current || p.sections.some((s) => s.url === current);
      const pages = [link(p, current, 'Overview'), ...p.sections.map((s) => link(s, current))].join('');
      return `<li><details class="guide-nav__ref"${here ? ' open' : ''}><summary>${escape(p.title)}</summary><ul>${pages}</ul></details></li>`;
    })
    .join('');
  return `<nav class="guide-nav" aria-label="Guide"><ul>${items}</ul></nav>`;
}

export const SITE = 'https://throng-ide.com';

/**
 * FR-041 — what a search engine and a link preview read: the description, the canonical URL, the Open Graph and
 * Twitter tags, the home page's icons, and the breadcrumb trail as JSON-LD.
 */
function described({ title, url, description, breadcrumbs }) {
  const trail = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: `${SITE}${b.url}` })),
  };
  const json = JSON.stringify(trail).replace(/</g, '\\u003c');
  return `<meta name="description" content="${escape(description)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${SITE}${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="throng">
<meta property="og:image" content="${SITE}/assets/social-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The throng icon beside the words: Every project, every terminal, one window.">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#172033">
<link rel="canonical" href="${SITE}${url}">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<script type="application/ld+json">${json}</script>`;
}

/**
 * FR-068 — where the page sits, above its heading: Guide, then its reference for a reference section, then the page.
 * The home page link is the header's, so the trail starts at the guide; a page with nothing above it but the home
 * page (the guide's start page, the sitemap) shows none. Search leaves it out of the page's text.
 */
function trail(breadcrumbs) {
  const steps = breadcrumbs.slice(1);
  if (steps.length < 2) return '';
  const items = steps.map((b, i) =>
    i === steps.length - 1
      ? `<li><span aria-current="page">${escape(b.name)}</span></li>`
      : `<li><a href="${b.url}">${escape(b.name)}</a></li>`,
  );
  return `<nav class="page-trail" aria-label="Breadcrumb" data-pagefind-ignore><ol>${items.join('')}</ol></nav>\n        `;
}

/**
 * A whole guide page. `search: false` leaves it out of the search index (the sitemap page, FR-042): Pagefind
 * indexes only pages marked data-pagefind-body. A `nav` of null draws no guide page list (the sitemap page, FR-066).
 */
export function renderPage({ template, nav, page, bodyHtml, description, breadcrumbs, search = true }) {
  const title = `${page.title} · throng guide`;
  const indexed = search ? ` data-pagefind-body data-pagefind-meta="title:${escape(page.title)}"` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${described({ title, url: page.url, description, breadcrumbs })}
<link rel="preload" href="/assets/fonts/schibsted-grotesk-latin-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/pagefind/pagefind-ui.css">
</head>
<body id="top" class="guide-page">
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
  ${template.header}
  <div class="guide${nav ? '' : ' guide--single'}">
    ${nav ? navigation(nav, page.url) : ''}
    <!-- FR-039: the footer sits in the page column, so the grid runs to the end of the document and the sticky
         page list beside it never moves. -->
    <div class="guide-body">
      <main id="main" class="guide-main"${indexed}>
        ${trail(breadcrumbs)}${bodyHtml}
      </main>
      ${template.footer}
    </div>
  </div>
</div>
<script src="/pagefind/pagefind-ui.js"></script>
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}
