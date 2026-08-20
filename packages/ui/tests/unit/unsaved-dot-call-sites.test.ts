import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The SHARED unsaved dot, wherever it is drawn (006 US8, 024 follow-up, FR-006d).
 *
 * ══ WHY A SOURCE GUARD AND NOT A RENDER ══
 *
 * There are four of these marks — the file tree row, the panel header, the tab chip and the project
 * list — and the whole point of the feature is that they are the SAME mark. That is a claim about
 * every site at once, which is exactly the shape `icon-call-sites.test.ts` argues a source guard is
 * the stronger test for: a component test renders one tree, and a fifth site added next year is
 * invisible to it. This guard walks the renderer and fails on any site it has not been told about.
 *
 * `component/file-tree.test.ts` asserts the tree's mark on a real rendered node, and this guard
 * asserts the property holds at every site it is written. Neither replaces the other.
 *
 * ══ THE GATE ON THE PANEL HEADER, WHICH IS THE ONE THAT HAS ALREADY BEEN WRONG ══
 *
 * Editor state is keyed by panel id and DELIBERATELY outlives an editor's unmount, so a document
 * can move between tabs and windows without being destroyed (`use-editor.ts`). A panel that once
 * held a dirty editor and has since been re-typed as a terminal therefore still HAS that state —
 * and the header's dot was reading it, so a terminal wore another document's unsaved mark: work the
 * user cannot reach from that panel and cannot save there.
 *
 * `tree-unsaved-dot.e2e.ts:62-76` is where that was caught, by adding a real `cmd` terminal to a
 * live app and reading one `<span>`. The rule it was checking is a one-line render gate, and this
 * is that line.
 *
 * ══ AND THIS FILE WAS WRONG ABOUT WHAT IT WAS REPLACING ══
 *
 * It used to end: *"PanelPlaceholder pulls thirty-odd contexts including dnd-kit and the PTY, and
 * rendering it to read one span would be the same trade this branch is undoing."* That was a guess
 * dressed as a measurement, and the measurement disagrees: SIX providers mount it, only
 * `useProjects` throws without one, and `component/panel-box.test.ts` now asserts this same gate on
 * a REAL rendered node — a terminal panel holding a dirty editor's state, drawing no dot.
 *
 * So the two are not rivals and neither is redundant. That test asserts the gate WHERE IT MATTERS,
 * on one rendered header. This guard asserts a property of EVERY site at once — same accessible
 * name, same tooltip, same testid shape, four sites and no fifth — which is a claim no single render
 * can make. The correction is recorded rather than quietly edited out, because "that component is
 * too heavy to mount" was the reason three other migrations stopped short, and it was not true.
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

const SOURCES = walk(RENDERER, /\.tsx$/);

/** Every `.tsx` line that draws the shared dot, as `<relative path>:<1-based line>`. */
function dotSites(): { site: string; file: string; line: number; text: string }[] {
  const found: { site: string; file: string; line: number; text: string }[] = [];
  for (const file of SOURCES) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (text.includes('throng-unsaved-dot')) {
        const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
        found.push({ site: `${rel}:${i + 1}`, file, line: i + 1, text });
      }
    });
  }
  return found;
}

/**
 * The four known sites, by file. Deliberately keyed by FILE rather than by line: a line number
 * churns on every edit above it, and a guard that has to be re-seeded for an unrelated change is a
 * guard people start editing without reading.
 */
const KNOWN = [
  'explorer/tree-node.tsx',
  'sidebar/projects-panel.tsx',
  'workspace/panel-placeholder.tsx',
  'workspace/tab-group.tsx',
] as const;

/** The ~12 lines around a site — enough to hold the JSX element and the condition it hangs off. */
function contextAround(file: string, line: number): string {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.slice(Math.max(0, line - 6), line + 8).join('\n');
}

describe('the shared unsaved dot is one mark, drawn the same way everywhere', () => {
  it('is drawn at exactly the four known sites', () => {
    const files = [...new Set(dotSites().map((s) => s.site.replace(/:\d+$/, '')))].sort();
    // A new site is not a failure of the feature — it is a site this guard has not been shown, and
    // one that has to be read before it is added here.
    expect(files).toEqual([...KNOWN].sort());
  });

  it('gives every mark the same accessible name and the same tooltip (FR-006d)', () => {
    for (const { site, file, line } of dotSites()) {
      const ctx = contextAround(file, line);
      // A dot is a glyph with no text, so removing either of these leaves a screen-reader user with
      // nothing at all — the specific failure the constitution's themeable-icon-control rule names.
      expect(ctx, `${site} has no aria-label`).toContain("aria-label=\"Unsaved changes\"");
      expect(ctx, `${site} has no title`).toContain('title="Unsaved changes"');
    }
  });

  it('gives every mark a testid naming what it marks', () => {
    for (const { site, file, line } of dotSites()) {
      const ctx = contextAround(file, line);
      expect(ctx, `${site} has no data-testid`).toMatch(/data-testid=\{`[a-z-]+-unsaved-\$\{/);
    }
  });
});

describe('the panel header gates its dot on the panel being an editor NOW', () => {
  it('reads the dot and the file pill off the same panel-kind test', () => {
    const file = join(RENDERER, 'workspace', 'panel-placeholder.tsx');
    const src = readFileSync(file, 'utf8');
    const idx = src.indexOf('throng-unsaved-dot');
    expect(idx, 'the panel header no longer draws the shared dot').toBeGreaterThan(-1);

    // The condition sits immediately above the element it guards. Reading backwards from the
    // className to the nearest `? (` opening is what a reader does, and it is what a regression
    // that drops the gate would break: the dot would hang off `editorUi?.dirty` alone.
    const before = src.slice(0, idx);
    const opening = before.lastIndexOf('{');
    const condition = src.slice(opening, idx);

    expect(
      condition,
      'the header dot is no longer gated on the panel being an editor — a terminal will wear a ' +
        "document's unsaved mark, which is what tree-unsaved-dot.e2e.ts:62 was filed for",
    ).toContain("panel.kind === 'editor'");
    expect(condition).toContain('dirty');
  });
});
