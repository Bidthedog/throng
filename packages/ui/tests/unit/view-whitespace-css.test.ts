/**
 * 059 FR-064 — every View Whitespace marker is one character cell, boxed in a contrasting colour (a space's dot
 * excepted).
 *
 * Layer: a source read of the stylesheet. jsdom lays nothing out, so no component test can measure a marker's
 * width or see its fill; the stylesheet is where both are decided, and this pins the decisions the user asked for.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/editor/editor.css', import.meta.url)),
  'utf8',
)
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list names `selector`, together. */
function rule(selector: string): string {
  const re = /([^{}]+)\{([^}]*)\}/g;
  const bodies: string[] = [];
  for (let m = re.exec(CSS); m; m = re.exec(CSS)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(m[2] ?? '');
  }
  if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
  return bodies.join('\n');
}

describe('View Whitespace markers (059 FR-064, FR-065)', () => {
  for (const cls of ['cm-ws-bom', 'cm-ws-control']) {
    it(`.${cls} is one cell wide`, () => {
      const body = rule(`.editor-panel .${cls}`);
      expect(body).toMatch(/(^|;|\s)width:\s*1ch/);
      expect(body).toMatch(/overflow:\s*hidden/);
      // Nothing that would widen the cell.
      expect(body).not.toMatch(/padding:\s*0\s+\d/);
      expect(body).not.toMatch(/margin(-left|-right)?:\s*(?!0[;\s])/);
    });
  }

  it('.cm-ws-eol takes its control picture’s own width: nothing follows it on its line (FR-065)', () => {
    expect(rule('.editor-panel .cm-ws-eol')).toMatch(/(^|;|\s)width:\s*auto/);
  });

  it('.cm-ws-eol has room around its label, drawn smaller than the text (FR-066)', () => {
    expect(rule('.editor-panel .cm-ws-eol')).toMatch(/padding:\s*0\s+\dpx/);
    expect(rule('.editor-panel .cm-ws-eol__label')).toMatch(/font-size:\s*0?\.\d+em/);
  });

  for (const cls of ['cm-ws-eol', 'cm-ws-bom', 'cm-ws-control']) {
    it(`.${cls} shows the help cursor only while hover names are on (FR-066, FR-067)`, () => {
      expect(rule(`.editor-panel .cm-ws-hover-names .${cls}`)).toMatch(/cursor:\s*help/);
      expect(rule(`.editor-panel .${cls}`)).not.toMatch(/cursor:/);
    });
  }

  it('the hover-name popover is a raised surface that never takes the pointer (FR-067)', () => {
    const body = rule('.cm-ws-hover-name');
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/background:\s*var\(--throng-colour-surfaceActive/);
  });

  it('a space and a tab keep the text cursor: they are characters the user selects (FR-066)', () => {
    expect(rule('.editor-panel .cm-ws-space')).not.toMatch(/cursor:/);
    expect(rule('.editor-panel .cm-ws-tab')).not.toMatch(/cursor:/);
  });

  for (const cls of ['cm-ws-space', 'cm-ws-tab', 'cm-ws-eol', 'cm-ws-bom', 'cm-ws-control']) {
    it(`.${cls} receives the pointer, so its hover name shows (FR-065)`, () => {
      expect(rule(`.editor-panel .${cls}`)).not.toMatch(/pointer-events:\s*none/);
    });
  }

  for (const cls of ['cm-ws-eol', 'cm-ws-bom', 'cm-ws-control']) {
    it(`.${cls} sits in a solid contrasting box`, () => {
      const body = rule(`.editor-panel .${cls}`);
      expect(body).toMatch(/display:\s*inline-block/);
      // The theme's own fill-and-text pair: `accent` is a fill, `accentText` the colour drawn ON it. Not the
      // other way round — `accentText` is a near-black, and as a fill on a dark editor it was invisible.
      expect(body).toMatch(/background:\s*var\(--throng-colour-accent\)/);
      expect(body).toMatch(/color:\s*var\(--throng-colour-accentText\)/);
    });
  }

  it('a tab is boxed across its own width, and a space is a dot with no box', () => {
    expect(rule('.editor-panel .cm-ws-tab')).toMatch(/background:\s*var\(--throng-colour-accent\)/);
    expect(rule('.editor-panel .cm-ws-space')).not.toMatch(/background/);
  });
});
