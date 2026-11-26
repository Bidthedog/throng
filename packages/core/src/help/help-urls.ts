/**
 * Help URLs (080 FR-009, FR-014): the ONLY place in the app a throng-ide.com guide URL is written. Every
 * other module asks for one by task (from the guide map) or by setting key, so a page that moves changes
 * here and nowhere else. `packages/ui/tests/unit/help-url-single-home.test.ts` fails on a guide URL
 * written anywhere else.
 *
 * `base` is the guide root. Help opens the guide shipped with the app, at {@link HELP_APP_BASE_URL}, in throng's
 * Help window (FR-048, FR-049); {@link HELP_BASE_URL} is the same guide on the website (release notes, Open in
 * browser).
 */
import { KEYBINDINGS_METADATA } from '../config/keybindings-metadata.js';
import { logExpected } from '../diagnostics/caught.js';
import type { MetadataRegistry } from '../config/metadata.js';
import { SETTINGS_METADATA } from '../config/settings-metadata.js';
import { THEME_METADATA } from '../config/theme-metadata.js';
import { GUIDE_MAP, GUIDE_PAGES, type GuidePageSlug, type GuideTask } from './guide-map.js';
import { referenceSlug } from './slug.js';

export const HELP_BASE_URL = 'https://throng-ide.com/guide/';

/** FR-049 — the root of the guide shipped with the app, served by main's read-only `throng-help:` scheme. */
export const HELP_APP_ROOT = 'throng-help://app/';
export const HELP_APP_BASE_URL = `${HELP_APP_ROOT}guide/`;

/** The website's root: where the shipped guide's pages also live, and where the home page's links point. */
export const WEBSITE_ROOT = 'https://throng-ide.com/';

/** FR-065 — where `npm run site:preview` serves the site: a development build's website. */
export const DEV_WEBSITE_ROOT = 'http://localhost:8080/';

/** FR-065 — the website the Help window sends links to: throng-ide.com when packaged, the local preview otherwise. */
export function websiteRootFor(packaged: boolean): string {
  return packaged ? WEBSITE_ROOT : DEV_WEBSITE_ROOT;
}

/**
 * Whether a shipped path is the guide's own (it opens in the Help window) rather than the rest of the website. The
 * sitemap is the website's (FR-066).
 */
const isGuidePath = (path: string): boolean => path === 'guide/' || path.startsWith('guide/');

/** A shipped URL's path below the app root, or undefined for any other URL. */
function appPath(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    logExpected('help-urls: appPath', 'a string that is not a URL is not a shipped guide page', error);
    return undefined;
  }
  if (parsed.protocol !== 'throng-help:' || parsed.host !== 'app') return undefined;
  return parsed.pathname.replace(/^\//, '') + parsed.search + parsed.hash;
}

/**
 * FR-051 — Open in browser: the website's copy of a shipped page (`index.html` dropped, as the site serves it), or
 * undefined for a URL that is not the shipped guide's.
 */
export function websiteUrlFor(appUrl: string, websiteRoot: string = WEBSITE_ROOT): string | undefined {
  const path = appPath(appUrl);
  return path === undefined ? undefined : websiteRoot + path.replace(/(^|\/)index\.html(?=$|[?#])/, '$1');
}

/** FR-050 — what the Help window does with a navigation or a window it is asked to open. */
export type HelpNavigation = { kind: 'stay' } | { kind: 'external'; url: string } | { kind: 'refuse' };

/**
 * FR-050 — the Help window shows only the shipped guide. A guide page stays; any other shipped path is the
 * home page's (its header links) and goes to the website in the OS browser, as does any http(s) link; anything else
 * is refused.
 */
export function decideHelpNavigation(url: string, websiteRoot: string = WEBSITE_ROOT): HelpNavigation {
  const path = appPath(url);
  if (path !== undefined) return isGuidePath(path) ? { kind: 'stay' } : { kind: 'external', url: websiteRoot + path };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    logExpected('help-urls: decideHelpNavigation', 'a string that is not a URL goes nowhere', error);
    return { kind: 'refuse' };
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? { kind: 'external', url } : { kind: 'refuse' };
}

const PREFERENCES_REFERENCE = 'reference/preferences/';
const KEY_BINDINGS_REFERENCE = 'reference/key-bindings/';
const THEME_SETTINGS_REFERENCE = 'reference/theme-settings/';

function checked(base: string): string {
  if (!base.endsWith('/')) throw new Error(`help base URL must end in /: ${base}`);
  return base;
}

function pagePath(page: GuidePageSlug): string {
  return page === 'index' ? '' : `${page}/`;
}

/** The guide's start page. */
export function startPageUrl(base: string = HELP_BASE_URL): string {
  return checked(base);
}

/** A task's section. Throws for a page and anchor the guide map does not hold. */
export function helpUrl(
  target: { page: GuidePageSlug; anchor: string },
  options: { base?: string; map?: readonly GuideTask[] } = {},
): string {
  const map = options.map ?? GUIDE_MAP;
  if (!map.some((t) => t.page === target.page && t.anchor === target.anchor)) {
    throw new Error(`no guide task ${target.page}#${target.anchor}`);
  }
  return `${checked(options.base ?? HELP_BASE_URL)}${pagePath(target.page)}#${target.anchor}`;
}

/**
 * A descriptor's entry in a reference: the section page named by its group (FR-026), anchored by its id.
 * Throws, naming the id, when the registry does not hold it.
 */
function referenceUrl(registry: MetadataRegistry, reference: string, what: string, key: string, base: string): string {
  const descriptor = registry.find((d) => d.key === key);
  if (descriptor === undefined) throw new Error(`no ${what} ${key}`);
  return `${checked(base)}${reference}${referenceSlug(descriptor.group)}/#${key}`;
}

/** A setting's entry in the preferences reference, on its group's page. Throws for an unknown key. */
export function settingHelpUrl(key: string, base: string = HELP_BASE_URL): string {
  return referenceUrl(SETTINGS_METADATA, PREFERENCES_REFERENCE, 'setting', key, base);
}

/** A command's entry in the key bindings reference, on its group's page (FR-028). Throws for an unknown action id. */
export function keyBindingHelpUrl(actionId: string, base: string = HELP_BASE_URL): string {
  return referenceUrl(KEYBINDINGS_METADATA, KEY_BINDINGS_REFERENCE, 'key binding', actionId, base);
}

/** A theme token's entry in the theme settings reference, on its area's page (FR-028). Throws for an unknown token. */
export function themeTokenHelpUrl(key: string, base: string = HELP_BASE_URL): string {
  return referenceUrl(THEME_METADATA, THEME_SETTINGS_REFERENCE, 'theme token', key, base);
}

/** The inverse, for the release-notes check: a guide task URL's page and anchor, or null. */
export function parseHelpUrl(
  url: string,
  base: string = HELP_BASE_URL,
): { page: GuidePageSlug; anchor: string } | null {
  if (!url.startsWith(checked(base))) return null;
  const match = /^(?:([a-z0-9-]+)\/)?#([^#\s]+)$/.exec(url.slice(base.length));
  if (match === null) return null;
  const page = (match[1] ?? 'index') as GuidePageSlug;
  if (!GUIDE_PAGES.some((p) => p.slug === page)) return null;
  return { page, anchor: match[2] as string };
}
