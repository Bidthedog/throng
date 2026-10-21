import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shared attention mark, wherever it is drawn (057 US2, FR-003, FR-010 – FR-013, FR-015, FR-017).
 * Modelled on `unsaved-dot-call-sites.test.ts`, for the same reason.
 *
 * ══ WHY A SOURCE GUARD AND NOT A RENDER ══
 *
 * There are six holders — a panel header, a tab chip, a tab-strip overflow control, a picker row, a
 * popover row, a project row and a category header — and the point of the feature is that they are the
 * SAME mark: one name (the holder's label, FR-015), one testid shape, one component.
 * That is a claim about every site at once. A component test renders one tree; a seventh holder added
 * next year is invisible to it. `component/*-attention.test.ts` assert each holder on a real node, and
 * this asserts the property across all of them. Neither replaces the other.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

const rel = (file: string): string => file.slice(RENDERER.length + 1).replace(/\\/g, '/');
const SOURCES = walk(RENDERER, /\.tsx$/).map((file) => ({ file, path: rel(file), text: readFileSync(file, 'utf8') }));

/** Each holder wrapper, and the ONE file allowed to render it. Keyed by file, not by line. */
const HOLDER_SITES: Record<string, readonly string[]> = {
  PanelHeaderMark: ['workspace/panel-placeholder.tsx'],
  ProjectRowLead: ['sidebar/projects-panel.tsx'],
  CategoryHeaderMark: ['sidebar/projects-panel.tsx'],
  TabMark: ['workspace/tab-group.tsx', 'workspace/tab-picker.tsx'],
  OverflowMark: ['workspace/tab-group.tsx'],
  PopoverPanelMark: ['workspace/tab-popover.tsx'],
};

/** Files that DEFINE the pieces, and so mention them without being a call site. */
const DEFINITIONS = new Set(['attention/holder-marks.tsx', 'attention/attention-mark.tsx']);

describe('the attention mark is one component, drawn the same way everywhere', () => {
  it('renders <AttentionMark> in exactly one place: the holder wrappers', () => {
    const users = SOURCES.filter((s) => /<AttentionMark\b/.test(s.text) && !DEFINITIONS.has(s.path)).map((s) => s.path);
    expect(users, 'a holder must go through attention/holder-marks.tsx so its name and testid are shared').toEqual([]);
    expect(SOURCES.find((s) => s.path === 'attention/holder-marks.tsx')?.text).toMatch(/<AttentionMark\b/);
  });

  it.each(Object.entries(HOLDER_SITES))('%s is rendered at exactly the known site(s)', (wrapper, expected) => {
    const found = SOURCES.filter((s) => new RegExp(`<${wrapper}\\b`).test(s.text) && !DEFINITIONS.has(s.path))
      .map((s) => s.path)
      .sort();
    // A new site is not a failure of the feature — it is a site this guard has not been shown, and one
    // that has to be read before it is added here.
    expect(found).toEqual([...expected].sort());
  });

  it('every holder wrapper gives its mark an `attention-<site>-` testid', () => {
    const text = SOURCES.find((s) => s.path === 'attention/holder-marks.tsx')!.text;
    const ids = [...text.matchAll(/testId=\{`([^`]+)`\}/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    // `attention-<site>-<id>` — the TabMark's site is `tab` or `tab-picker`, passed in.
    expect(ids.sort()).toEqual(
      [
        'attention-category-${categoryId}',
        'attention-overflow-${side}',
        'attention-panel-${panelId}',
        'attention-project-${projectId}',
        'attention-tab-popover-${panelId}',
        'attention-${site}-${tabId}',
      ].sort(),
    );
  });

  it('gives every mark the same accessible name, the holder label, and no native tooltip (FR-015, FR-123)', () => {
    const text = SOURCES.find((s) => s.path === 'attention/attention-mark.tsx')!.text;
    // FR-123: no holder repeats the label as a `title`; only an empty one, to block an ancestor's.
    expect(text).toContain('title={blockAncestorTitle ? \'\' : undefined}');
    expect(SOURCES.some((s) => /tooltip=\{/.test(s.text) && s.path.startsWith('attention/'))).toBe(false);
    expect(text).toContain('aria-label={mark.label}');
    expect(text).toContain('role="img"');
    expect(text).toContain('data-testid={testId}');
  });

  it('draws the kind with its ICON as well as its colour (FR-016)', () => {
    const text = SOURCES.find((s) => s.path === 'attention/attention-mark.tsx')!.text;
    expect(text).toMatch(/'attentionFailed'\s*:\s*'attention'/);
  });

  it('shares nothing with the unsaved dot (FR-017)', () => {
    for (const s of SOURCES.filter((x) => x.path.startsWith('attention/'))) {
      expect(s.text, `${s.path} reuses the unsaved dot's class`).not.toContain('throng-unsaved-dot');
    }
  });
});
