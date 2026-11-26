import { describe, expect, it } from 'vitest';

import {
  HELP_APP_BASE_URL,
  HELP_BASE_URL,
  decideHelpNavigation,
  websiteRootFor,
  websiteUrlFor,
  KEYBINDINGS_METADATA,
  SETTINGS_METADATA,
  THEME_METADATA,
  helpUrl,
  keyBindingHelpUrl,
  parseHelpUrl,
  referenceSlug,
  settingHelpUrl,
  startPageUrl,
  themeTokenHelpUrl,
} from '../../src/index.js';
import type { GuideTask } from '../../src/index.js';

/** 080 FR-009, FR-014 — every help URL is built here, from one base, against the map and the settings. */

const task = (page: GuideTask['page'], anchor: string): GuideTask => ({
  page,
  anchor,
  task: anchor,
  commands: [],
  panelTypes: [],
  previewTypes: [],
  settings: [],
});
const MAP = [task('terminals', 'open-a-terminal'), task('index', 'what-throng-is-for')];

describe('help URLs', () => {
  it('opens the guide on throng-ide.com by default', () => {
    expect(HELP_BASE_URL).toBe('https://throng-ide.com/guide/');
    expect(startPageUrl()).toBe('https://throng-ide.com/guide/');
  });

  it("builds a task's URL from its page and anchor", () => {
    expect(helpUrl({ page: 'terminals', anchor: 'open-a-terminal' }, { map: MAP })).toBe(
      'https://throng-ide.com/guide/terminals/#open-a-terminal',
    );
    expect(helpUrl({ page: 'index', anchor: 'what-throng-is-for' }, { map: MAP })).toBe(
      'https://throng-ide.com/guide/#what-throng-is-for',
    );
  });

  it('refuses a task the map does not hold', () => {
    expect(() => helpUrl({ page: 'terminals', anchor: 'nope' }, { map: MAP })).toThrow(/terminals#nope/);
  });

  it("builds a setting's URL from its group's section page and its key (FR-026)", () => {
    expect(settingHelpUrl('window.nativeWayland')).toBe(
      'https://throng-ide.com/guide/reference/preferences/general/#window.nativeWayland',
    );
  });

  it('names the section page of every setting from its own group', () => {
    for (const d of SETTINGS_METADATA) {
      expect(settingHelpUrl(d.key)).toBe(`${HELP_BASE_URL}reference/preferences/${referenceSlug(d.group)}/#${d.key}`);
    }
  });

  it('refuses a key that is not a setting', () => {
    expect(() => settingHelpUrl('no.such.setting')).toThrow(/no\.such\.setting/);
  });

  it('uses a given base instead, which must end in a slash', () => {
    const base = 'http://127.0.0.1:8080/guide/';
    expect(startPageUrl(base)).toBe(base);
    expect(settingHelpUrl('window.nativeWayland', base)).toBe(
      `${base}reference/preferences/general/#window.nativeWayland`,
    );
    expect(keyBindingHelpUrl('help.open', base)).toBe(`${base}reference/key-bindings/application/#help.open`);
    expect(themeTokenHelpUrl('colours.accent', base)).toBe(`${base}reference/theme-settings/general/#colours.accent`);
    expect(() => startPageUrl('http://127.0.0.1:8080/guide')).toThrow(/end in \//);
    expect(() => keyBindingHelpUrl('help.open', 'http://127.0.0.1:8080/guide')).toThrow(/end in \//);
  });
});

describe('key binding and theme token help URLs (FR-028)', () => {
  it("builds a key binding's URL from its group's section page and its action id", () => {
    expect(keyBindingHelpUrl('help.open')).toBe('https://throng-ide.com/guide/reference/key-bindings/application/#help.open');
    for (const d of KEYBINDINGS_METADATA) {
      expect(keyBindingHelpUrl(d.key)).toBe(`${HELP_BASE_URL}reference/key-bindings/${referenceSlug(d.group)}/#${d.key}`);
    }
  });

  it("builds a theme token's URL from its area's section page and its key", () => {
    expect(themeTokenHelpUrl('colours.accent')).toBe(
      'https://throng-ide.com/guide/reference/theme-settings/general/#colours.accent',
    );
    for (const d of THEME_METADATA) {
      expect(themeTokenHelpUrl(d.key)).toBe(`${HELP_BASE_URL}reference/theme-settings/${referenceSlug(d.group)}/#${d.key}`);
    }
  });

  it('refuses an id the registry does not hold', () => {
    expect(() => keyBindingHelpUrl('no.such.action')).toThrow(/no\.such\.action/);
    expect(() => themeTokenHelpUrl('colours.noSuchToken')).toThrow(/colours\.noSuchToken/);
  });
});

describe('referenceSlug — GitHub heading slug, the one rule the guide builder uses', () => {
  it.each([
    ['General', 'general'],
    ['Focus & Zoom', 'focus--zoom'],
    ['Main panel / workspace', 'main-panel--workspace'],
    ['  Projects / sidebar  ', 'projects--sidebar'],
    ['The `files.exclude` key', 'the-filesexclude-key'],
    ['Tabs_and-panels', 'tabs_and-panels'],
    ['Éditeur 2', 'éditeur-2'],
    ['Typography: Pane title', 'typography-pane-title'],
  ])('%j → %j', (heading, slug) => {
    expect(referenceSlug(heading)).toBe(slug);
  });
});

describe('the guide shipped with the app (FR-049, FR-051)', () => {
  it('roots Help at the shipped guide, and the website stays where it was', () => {
    expect(HELP_APP_BASE_URL).toBe('throng-help://app/guide/');
    expect(HELP_BASE_URL).toBe('https://throng-ide.com/guide/');
    expect(settingHelpUrl('window.nativeWayland', HELP_APP_BASE_URL)).toMatch(/^throng-help:\/\/app\/guide\/reference\/preferences\//);
  });

  it('names the same page on the website for Open in browser', () => {
    expect(websiteUrlFor('throng-help://app/guide/terminals/#open-a-terminal')).toBe('https://throng-ide.com/guide/terminals/#open-a-terminal');
    expect(websiteUrlFor('throng-help://app/sitemap/')).toBe('https://throng-ide.com/sitemap/');
    expect(websiteUrlFor('throng-help://app/guide/index.html')).toBe('https://throng-ide.com/guide/');
    expect(websiteUrlFor('https://example.test/')).toBeUndefined();
  });
});

describe('the website follows the build (FR-065)', () => {
  it('is throng-ide.com when packaged and the local preview otherwise', () => {
    expect(websiteRootFor(true)).toBe('https://throng-ide.com/');
    expect(websiteRootFor(false)).toBe('http://localhost:8080/');
  });

  it('sends Open in browser and every website link to the root it is given', () => {
    const dev = websiteRootFor(false);
    expect(websiteUrlFor('throng-help://app/guide/terminals/#open-a-terminal', dev)).toBe('http://localhost:8080/guide/terminals/#open-a-terminal');
    expect(decideHelpNavigation('throng-help://app/#features', dev)).toEqual({ kind: 'external', url: 'http://localhost:8080/#features' });
    expect(decideHelpNavigation('throng-help://app/guide/', dev)).toEqual({ kind: 'stay' });
  });
});

describe('decideHelpNavigation (FR-050)', () => {
  it.each([
    ['throng-help://app/guide/', 'stay'],
    ['throng-help://app/guide/terminals/#open-a-terminal', 'stay'],
    ['throng-help://app/guide/images/terminals/open-a-terminal.png', 'stay'],
  ])('keeps %s in the Help window', (url, kind) => {
    expect(decideHelpNavigation(url)).toEqual({ kind });
  });

  it.each([
    ['throng-help://app/', 'https://throng-ide.com/'],
    ['throng-help://app/#install', 'https://throng-ide.com/#install'],
    // FR-066 — the sitemap is the website's.
    ['throng-help://app/sitemap/', 'https://throng-ide.com/sitemap/'],
    ['throng-help://app/assets/throng-repo-key.asc', 'https://throng-ide.com/assets/throng-repo-key.asc'],
    ['https://github.com/Bidthedog/throng', 'https://github.com/Bidthedog/throng'],
    ['http://example.test/a', 'http://example.test/a'],
  ])('sends %s to the OS browser as %s', (url, external) => {
    expect(decideHelpNavigation(url)).toEqual({ kind: 'external', url: external });
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'throng-preview://asset/x/y', 'not a url', 'throng-help://elsewhere/guide/'])(
    'refuses %s',
    (url) => {
      expect(decideHelpNavigation(url)).toEqual({ kind: 'refuse' });
    },
  );
});

describe('parseHelpUrl', () => {
  it("reads a task URL's page and anchor", () => {
    expect(parseHelpUrl('https://throng-ide.com/guide/terminals/#open-a-terminal')).toEqual({
      page: 'terminals',
      anchor: 'open-a-terminal',
    });
    expect(parseHelpUrl('https://throng-ide.com/guide/#what-throng-is-for')).toEqual({
      page: 'index',
      anchor: 'what-throng-is-for',
    });
  });

  it('returns null for anything else', () => {
    expect(parseHelpUrl('https://throng-ide.com/')).toBeNull();
    expect(parseHelpUrl('https://throng-ide.com/guide/terminals/')).toBeNull();
    expect(parseHelpUrl('https://throng-ide.com/guide/no-such-page/#x')).toBeNull();
    expect(parseHelpUrl('https://example.com/guide/terminals/#x')).toBeNull();
  });
});
