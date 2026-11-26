/**
 * The documentation set stays linked, indexed and complete (the maintainer's documentation rules,
 * 2026-09-27; the `throng-docs` skill owns them — this file is the part of its audit a machine can do).
 *
 * - Every page under docs/ opens with its breadcrumb, and docs/README.md indexes every page.
 * - Every relative link in README.md, CONTRIBUTING.md and docs/ resolves, anchors included.
 * - Every default key binding, every configurable setting and every THRONG_* variable the code
 *   reads is documented in its one home: key-bindings.md, preferences.md, environment.md.
 * - README.md stays an entry point, not a manual.
 *
 * A red run here is fixed in the docs, never by loosening the list: a new binding, setting or
 * variable ships with its line in the right file.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  GUIDE_EXCLUSIONS,
  GUIDE_MAP,
  GUIDE_PAGES,
  HELP_BASE_URL,
  KEYBINDINGS_METADATA,
  SETTINGS_METADATA,
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  THEME_METADATA,
  defaultPanelTypeRegistry,
  settingsLeaves,
  type GuideExclusion,
} from '@throng/core';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const read = (p: string): string => readFileSync(p, 'utf8');

const docPages = (): string[] =>
  readdirSync(DOCS)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => join(DOCS, f));

/** The files whose links are checked: the entry points and every docs page. */
const linkedFiles = (): string[] => [join(ROOT, 'README.md'), join(ROOT, 'CONTRIBUTING.md'), ...docPages()];

/** GitHub's heading anchor: lower-cased, punctuation dropped (hyphens kept), spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Every anchor a markdown file offers, with GitHub's -1, -2 suffixes for repeated headings. */
function anchorsOf(file: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of read(file).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1] as string);
    const n = seen.get(base) ?? 0;
    anchors.add(n === 0 ? base : `${base}-${n}`);
    seen.set(base, n + 1);
  }
  for (const m of read(file).matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(m[1] as string);
  return anchors;
}

/** Relative markdown links outside code fences and inline code. */
function linksOf(file: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of read(file).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    if (inFence) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1] as string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
      out.push(target);
    }
  }
  return out;
}

describe('docs pages carry their breadcrumb and are indexed', () => {
  it('every page under docs/ opens with a breadcrumb back to the README and the docs index', () => {
    for (const page of docPages()) {
      const first = read(page).split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
      const isIndex = page.toLowerCase().endsWith(join('docs', 'readme.md'));
      const expected = isIndex ? '[throng](../README.md) › Docs' : '[throng](../README.md) › [Docs](README.md) › ';
      expect(first.startsWith(expected), `${relative(ROOT, page)} starts with "${first}"`).toBe(true);
    }
  });

  it('docs/README.md links every page under docs/', () => {
    const index = join(DOCS, 'README.md');
    const linked = new Set(linksOf(index).map((l) => l.split('#')[0]?.toLowerCase()));
    for (const page of docPages()) {
      const name = relative(DOCS, page);
      if (name.toLowerCase() === 'readme.md') continue;
      expect(linked.has(name.toLowerCase()), `docs/README.md does not link ${name}`).toBe(true);
    }
  });
});

describe('every relative link resolves', () => {
  it('points at a file that exists, and at an anchor that file has', () => {
    const broken: string[] = [];
    for (const file of linkedFiles()) {
      for (const link of linksOf(file)) {
        const [path, anchor] = link.split('#') as [string, string | undefined];
        const target = path === '' ? file : resolve(dirname(file), decodeURIComponent(path));
        if (!existsSync(target)) {
          broken.push(`${relative(ROOT, file)} → ${link} (no such file)`);
          continue;
        }
        if (anchor && statSync(target).isFile() && target.toLowerCase().endsWith('.md') && !anchorsOf(target).has(anchor)) {
          broken.push(`${relative(ROOT, file)} → ${link} (no such anchor)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('every binding, setting and variable is documented in its one home', () => {
  it('docs/key-bindings.md names every action in the Key Bindings editor, by id', () => {
    const doc = read(join(DOCS, 'key-bindings.md'));
    const missing = KEYBINDINGS_METADATA.map((d) => d.key).filter((id) => !doc.includes(`\`${id}\``));
    expect(missing).toEqual([]);
  });

  it('docs/preferences.md names every configurable setting, by key', () => {
    const doc = read(join(DOCS, 'preferences.md'));
    const missing = settingsLeaves().filter((key) => !doc.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });

  it('docs/environment.md names every THRONG_* variable the app, scripts or E2E harness reads', () => {
    const doc = read(join(DOCS, 'environment.md'));
    const roots = [
      ...readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p, 'src')),
      join(ROOT, 'scripts'),
      join(ROOT, 'packages', 'ui', 'tests', 'e2e'),
    ].filter((d) => existsSync(d));
    const names = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== 'node_modules' && entry !== 'dist') walk(p);
        } else if (/\.(m?[jt]sx?)$/.test(entry)) {
          for (const m of read(p).matchAll(/process\.env(?:\.|\[['"])(THRONG_[A-Z0-9_]+)/g)) names.add(m[1] as string);
        }
      }
    };
    roots.forEach(walk);
    const missing = [...names].sort().filter((n) => !doc.includes(`\`${n}\``));
    expect(names.size, 'the scan found no THRONG_* variables at all').toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('README.md stays an entry point', () => {
  it('is short, and links down to installation, the user guide, the docs index and CONTRIBUTING', () => {
    const readme = read(join(ROOT, 'README.md'));
    expect(readme.split(/\r?\n/).length, 'README.md has grown past an entry point').toBeLessThanOrEqual(150);
    // 080 US1 AC4: the guide is linked where it is published, from its start page and its Quick start.
    for (const target of [
      'docs/installation.md',
      `${HELP_BASE_URL}quick-start/`,
      HELP_BASE_URL,
      'docs/README.md',
      'CONTRIBUTING.md',
    ]) {
      expect(readme.includes(`(${target}`), `README.md does not link ${target}`).toBe(true);
    }
  });

  it('badges the newest release by date, and each supported platform', () => {
    const readme = read(join(ROOT, 'README.md'));
    const release = /https:\/\/img\.shields\.io\/github\/v\/release\/[^)\s]+/.exec(readme)?.[0] ?? '';
    expect(release, 'README.md has no latest-release badge').not.toBe('');
    // semver ranks a prerelease's tag as one identifier, compared as text: alpha9 above alpha16. The
    // badge sat on alpha9 through six releases.
    expect(release).toContain('include_prereleases');
    expect(release).toContain('sort=date');
    for (const platform of ['Windows', 'Linux', 'macOS']) {
      expect(readme, `README.md has no ${platform} platform badge`).toMatch(new RegExp(`img\\.shields\\.io/badge/[^)]*${platform}`));
    }
  });

  // 072 FR-029: one badge per pipeline, each reading the runs that pipeline actually makes. CI runs only on pull
  // requests and the nightly only on schedule, so a badge filtered by branch alone would read a stale or empty status.
  it('badges each of the three pipelines by the runs it makes', () => {
    const readme = read(join(ROOT, 'README.md'));
    const actions = 'https://github.com/Bidthedog/throng/actions/workflows';
    expect(readme).toContain(`${actions}/ci.yml/badge.svg?event=pull_request`);
    expect(readme).toContain(`${actions}/pipeline.yml/badge.svg?branch=master&event=schedule`);
    expect(readme).toContain(`${actions}/release.yml/badge.svg)`);
    expect(readme, 'README.md still badges a retired workflow').not.toMatch(/workflows\/gate\.yml/);
  });

  it('gives the website the same three pipeline badges', () => {
    const site = read(join(ROOT, 'site', 'index.html'));
    const actions = 'https://github.com/Bidthedog/throng/actions/workflows';
    expect(site).toContain(`${actions}/ci.yml/badge.svg?event=pull_request`);
    expect(site).toContain(`${actions}/pipeline.yml/badge.svg?branch=master&amp;event=schedule`);
    expect(site).toContain(`${actions}/release.yml/badge.svg"`);
    expect(site, 'site/index.html still badges a retired workflow').not.toMatch(/workflows\/gate\.yml/);
  });
});

/** 070 SC-007, retargeted by 080 (research R14) at the guide's Quick start, which replaced docs/quick-start.md. */
describe('macOS coverage of the Quick start (070 SC-007)', () => {
  it('names, for every Quick start task, what proves it on macOS', () => {
    const headings = read(join(ROOT, 'site', 'guide', 'quick-start.md'))
      .split('\n')
      .filter((line) => /^## /.test(line))
      .map((line) => line.replace(/^## /, '').trim());
    expect(headings.length, 'site/guide/quick-start.md has no task headings').toBeGreaterThan(0);
    const macos = read(join(DOCS, 'macos.md'));
    const start = macos.indexOf('## Coverage of the Quick start');
    expect(start, 'docs/macos.md has no "## Coverage of the Quick start" section').toBeGreaterThanOrEqual(0);
    const rows = macos
      .slice(start)
      .split('\n')
      .filter((line) => line.startsWith('| '))
      .map((line) => line.split('|')[1]?.trim() ?? '');
    for (const heading of headings) {
      expect(rows, `docs/macos.md's coverage table has no row for "${heading}"`).toContain(heading);
    }
  });
});

/**
 * 080 FR-004a, FR-015, FR-018 (contracts/guide-map.md § Checks) — the guide map, the guide's pages and the
 * preferences reference agree, and everything a user can do is taught somewhere or excluded with a reason.
 */
describe('the user guide covers the app (080)', () => {
  const GUIDE = join(ROOT, 'site', 'guide');
  const guideFiles = (): string[] => readdirSync(GUIDE).filter((f) => f.endsWith('.md'));
  const REFERENCE_FILES = ['preferences.md', 'key-bindings.md', 'theme-settings.md'];
  const frontMatter = (file: string): Record<string, string> => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(join(GUIDE, file)));
    const fields: Record<string, string> = {};
    for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
      const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
      if (kv) fields[kv[1] as string] = (kv[2] as string).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return fields;
  };
  /** Each page's `##` task headings, as their anchors. */
  const taskHeadings = (): Array<{ page: string; anchor: string; heading: string }> =>
    guideFiles().flatMap((f) =>
      read(join(GUIDE, f))
        .split(/\r?\n/)
        .filter((l) => /^## /.test(l))
        .map((l) => ({ page: f.replace(/\.md$/, ''), heading: l.slice(3).trim(), anchor: slug(l.slice(3)) })),
    );

  it("lists the pages in GUIDE_PAGES' order, with the titles GUIDE_PAGES gives them", () => {
    const fromFiles = guideFiles()
      .map((f) => ({ slug: f.replace(/\.md$/, ''), ...frontMatter(f) }))
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((p) => `${p.slug}: ${p.title}`);
    expect(fromFiles).toEqual(GUIDE_PAGES.map((p) => `${p.slug}: ${p.title}`));
  });

  it('has a map entry for every task heading in site/guide/, and a heading for every map entry', () => {
    const headings = taskHeadings().map((h) => `${h.page}#${h.anchor}`);
    const mapped = GUIDE_MAP.map((t) => `${t.page}#${t.anchor}`);
    expect(
      headings.filter((h) => !mapped.includes(h)),
      'task headings with no GUIDE_MAP entry',
    ).toEqual([]);
    expect(
      mapped.filter((m) => !headings.includes(m)),
      'GUIDE_MAP entries whose heading is not in site/guide/',
    ).toEqual([]);
  });

  const covered = (kind: GuideExclusion['kind'], field: 'commands' | 'panelTypes' | 'previewTypes', ids: string[]) => {
    const inMap = new Set(GUIDE_MAP.flatMap((t) => t[field] as readonly string[]));
    const excluded = new Set(GUIDE_EXCLUSIONS.filter((e) => e.kind === kind).map((e) => e.id));
    return ids.filter((id) => !inMap.has(id) && !excluded.has(id));
  };

  it('teaches every command, or excludes it with a reason', () => {
    expect(covered('command', 'commands', Object.keys(DEFAULT_KEYBINDINGS.bindings)), 'commands in no guide task').toEqual(
      [],
    );
  });

  it('teaches every panel type, or excludes it with a reason', () => {
    const kinds = defaultPanelTypeRegistry.list().map((d) => d.id);
    expect(covered('panelType', 'panelTypes', kinds), 'panel types in no guide task').toEqual([]);
  });

  it('teaches every preview type, or excludes it with a reason', () => {
    const ids = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.map((d) => d.id);
    expect(covered('previewType', 'previewTypes', ids), 'preview types in no guide task').toEqual([]);
  });

  /**
   * Each keyed section, by key: a heading, its bold breadcrumb (080 FR-059), its key code span, then the lead
   * line. `crumb` is false for a section whose breadcrumb is missing.
   */
  const sectionsByKey = (file: string): Map<string, { lead: string; crumb: boolean }> => {
    const lines = read(join(DOCS, file)).split(/\r?\n/);
    const found = new Map<string, { lead: string; crumb: boolean }>();
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^#{2,6} /.test(lines[i] as string)) continue;
      const crumb = isBreadcrumb((lines[i + 2] ?? '').trim());
      const at = crumb ? i + 4 : i + 2;
      const key = /^`([^`]+)`$/.exec((lines[at] ?? '').trim());
      if (key) found.set(key[1] as string, { lead: (lines[at + 2] ?? '').trim(), crumb });
    }
    return found;
  };
  const leads = (file: string): Map<string, string> =>
    new Map([...sectionsByKey(file)].map(([key, s]) => [key, s.lead]));
  const REFERENCES = [
    { file: 'preferences.md', what: 'setting', registry: SETTINGS_METADATA },
    { file: 'key-bindings.md', what: 'key binding', registry: KEYBINDINGS_METADATA },
    { file: 'theme-settings.md', what: 'theme setting', registry: THEME_METADATA },
  ] as const;

  for (const ref of REFERENCES) {
    it(`gives every ${ref.what} a section in docs/${ref.file}, led by its own description (080 FR-016, FR-028)`, () => {
      const lead = leads(ref.file);
      const missing = ref.registry.filter((d) => !lead.has(d.key)).map((d) => d.key);
      expect(missing, `${ref.what}s with no section of their own in docs/${ref.file}`).toEqual([]);
      const differ = ref.registry.filter((d) => lead.has(d.key) && lead.get(d.key) !== d.description).map((d) => d.key);
      expect(differ, `sections whose lead paragraph is not the ${ref.what}'s description`).toEqual([]);
    });

    it(`opens every ${ref.what}'s section in docs/${ref.file} with a bold breadcrumb (080 FR-059)`, () => {
      const crumbless = [...sectionsByKey(ref.file)].filter(([, s]) => !s.crumb).map(([key]) => key);
      expect(crumbless, `${ref.what} sections with no breadcrumb after the heading`).toEqual([]);
    });

    it(`has a ## section in docs/${ref.file} for every ${ref.what} group, which its (?) URL names (080 FR-026)`, () => {
      const headings = new Set(
        read(join(DOCS, ref.file))
          .split(/\r?\n/)
          .filter((l) => /^## /.test(l))
          .map((l) => l.slice(3).trim()),
      );
      const groups = [...new Set(ref.registry.map((d) => d.group))];
      expect(groups.filter((g) => !headings.has(g)), `${ref.what} groups with no ## heading`).toEqual([]);
    });
  }

  /** Pages that teach no task, and so take no task layout and need no screenshot. */
  const NO_TASKS = new Set(['index.md', 'faq.md']);

  it('ships no page as an outline (080 FR-033)', () => {
    expect(guideFiles().filter((f) => frontMatter(f).status === 'outline'), 'pages marked status: outline').toEqual([]);
  });

  /** A paragraph that is wholly bold, with no label: a breadcrumb (080 FR-059). */
  const isBreadcrumb = (p: string): boolean => /^\*\*[^*\n][\s\S]*\*\*$/.test(p) && !/^\*\*Where:/.test(p);
  /** Prose: not a list, an image, a callout, a table or a code block. */
  const isProse = (p: string): boolean => !/^(\d+\.|[-*] |!\[|>|\||```|`[^`]+`$)/.test(p);
  const paragraphs = (body: string): string[] =>
    body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p !== '');

  it('lays out every task: a bold breadcrumb, a prose lead, then numbered steps (080 FR-059)', () => {
    const broken: string[] = [];
    for (const f of guideFiles().filter((g) => !NO_TASKS.has(g))) {
      const sections = read(join(GUIDE, f)).split(/^## /m).slice(1);
      for (const s of sections) {
        const [heading, ...body] = s.split(/\r?\n/);
        const paras = paragraphs(body.join('\n'));
        const ok =
          isBreadcrumb(paras[0] ?? '') && isProse(paras[1] ?? '') && paras.slice(1).some((p) => /^1\. \S/.test(p));
        if (!ok) broken.push(`${f}: ${heading}`);
      }
    }
    expect(broken, 'task sections not opening with a bold breadcrumb, a prose lead and numbered steps').toEqual([]);
  });

  it('carries no Where or Why prefix on any guide or reference page (080 FR-059, supersedes FR-030)', () => {
    const files = [...guideFiles().map((f) => join(GUIDE, f)), ...REFERENCE_FILES.map((f) => join(DOCS, f))];
    const found = files.flatMap((file) =>
      paragraphs(read(file))
        .filter((p) => /^\*\*Where:\*\*|^\*Why you'd use this:\*/.test(p))
        .map((p) => `${relative(ROOT, file)}: ${p.slice(0, 40)}`),
    );
    expect(found).toEqual([]);
  });

  it('uses none of the banned AI phrases in the guide, the references or an in-app description (080 FR-058)', () => {
    const BANNED = /says so|you can never|no one noticed|silently fail/i;
    const texts: Array<[string, string]> = [
      ...guideFiles().map((f): [string, string] => [`site/guide/${f}`, read(join(GUIDE, f))]),
      ...REFERENCE_FILES.map((f): [string, string] => [`docs/${f}`, read(join(DOCS, f))]),
      ...SETTINGS_METADATA.map((d): [string, string] => [`setting ${d.key}`, d.description]),
      ...KEYBINDINGS_METADATA.map((d): [string, string] => [`key binding ${d.key}`, d.description]),
      ...THEME_METADATA.map((d): [string, string] => [`theme setting ${d.key}`, d.description]),
    ];
    const found = texts.flatMap(([where, text]) =>
      text.split(/\r?\n/).flatMap((line) => {
        const hit = BANNED.exec(line);
        return hit ? [`${where}: "${hit[0]}"`] : [];
      }),
    );
    expect(found, 'banned phrases (rewrite the sentence; stop-slop)').toEqual([]);
  });

  it('shows at least one screenshot of its own on every page that teaches a task (080 FR-031)', () => {
    const missing = guideFiles()
      .filter((f) => !NO_TASKS.has(f))
      .filter((f) => {
        const page = f.replace(/\.md$/, '');
        const images = [...read(join(GUIDE, f)).matchAll(/!\[[^\]]*\]\((images\/[^)\s]+)\)/g)].map((m) => m[1] as string);
        return !images.some((i) => i.startsWith(`images/${page}/`) && existsSync(join(GUIDE, i)));
      });
    expect(missing, 'pages with no existing screenshot under images/<page>/').toEqual([]);
  });

  it('has only landscape screenshots, so each fills the page column (080 FR-037)', () => {
    const images = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const path = join(dir, f);
        return statSync(path).isDirectory() ? images(path) : f.endsWith('.png') ? [path] : [];
      });
    const portrait = images(join(GUIDE, 'images')).filter((path) => {
      const png = readFileSync(path);
      return png.readUInt32BE(20) >= png.readUInt32BE(16);
    });
    expect(portrait.map((p) => relative(GUIDE, p)), 'portrait screenshots: take them with the panel filling the window').toEqual([]);
  });

  it('links only screenshots that exist', () => {
    const dead = guideFiles().flatMap((f) =>
      [...read(join(GUIDE, f)).matchAll(/!\[[^\]]*\]\((images\/[^)\s]+)\)/g)]
        .map((m) => m[1] as string)
        .filter((i) => !existsSync(join(GUIDE, i)))
        .map((i) => `${f}: ${i}`),
    );
    expect(dead, 'images linked from site/guide/ that do not exist').toEqual([]);
  });
});
