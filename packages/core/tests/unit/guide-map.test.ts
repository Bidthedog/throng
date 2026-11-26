import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GUIDE_EXCLUSIONS, GUIDE_MAP, GUIDE_PAGES } from '../../src/index.js';

/**
 * 080 FR-004, FR-004a — the guide map's own shape. Its coverage of the app (every command, panel type
 * and preview type) and its agreement with the pages in `site/guide/` are checked in
 * `packages/ui/tests/unit/docs-currency.test.ts`, which reads both packages and the docs.
 */

const PAGE_PLAN = join(__dirname, '../../../../specs/080-help-and-wiki/page-plan.md');

function plannedTitles(): string[] {
  return readFileSync(PAGE_PLAN, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^## \d+\. (.+)$/.exec(line)?.[1]?.trim())
    .filter((title): title is string => title !== undefined);
}

describe('GUIDE_PAGES', () => {
  it('lists every page in the page plan, in its order', () => {
    expect(GUIDE_PAGES.map((p) => p.title)).toEqual(plannedTitles());
  });

  it('opens with the start page and then Quick start', () => {
    expect(GUIDE_PAGES[0]?.slug).toBe('index');
    expect(GUIDE_PAGES[1]?.slug).toBe('quick-start');
  });

  it('gives every page a distinct slug', () => {
    const slugs = GUIDE_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('GUIDE_MAP', () => {
  it('names only pages in GUIDE_PAGES', () => {
    const slugs = new Set<string>(GUIDE_PAGES.map((p) => p.slug));
    for (const task of GUIDE_MAP) expect(slugs, `${task.page}#${task.anchor}`).toContain(task.page);
  });

  it('holds each (page, anchor) once', () => {
    const keys = GUIDE_MAP.map((t) => `${t.page}#${t.anchor}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('GUIDE_EXCLUSIONS', () => {
  it('gives every exclusion a reason', () => {
    for (const exclusion of GUIDE_EXCLUSIONS) {
      expect(exclusion.reason.trim(), `${exclusion.kind} ${exclusion.id}`).not.toBe('');
    }
  });
});
