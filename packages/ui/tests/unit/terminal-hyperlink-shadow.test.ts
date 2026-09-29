import { describe, expect, it } from 'vitest';
import { pathLinkUnder, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';

/**
 * #451 — a program wraps a detected path in an OSC 8 hyperlink whose target has no scheme (Claude
 * Code's Markdown `[path](path)`). xterm's own OSC 8 provider claims those cells first, so the
 * terminal asks for the path link lying under the hyperlink and hands the gesture to it.
 */
const link = (kind: 'file' | 'web', sy: number, sx: number, ey: number, ex: number): ProvidedLink => ({
  kind,
  text: `${kind}@${sy}:${sx}`,
  range: { start: { x: sx, y: sy }, end: { x: ex, y: ey } },
  decorations: { underline: false, pointerCursor: false },
  activate: () => {},
  hover: () => {},
  leave: () => {},
});

const providerOf = (links: ProvidedLink[]) => ({ linksOnLine: () => links });
const range = (sy: number, sx: number, ey: number, ex: number) => ({ start: { x: sx, y: sy }, end: { x: ex, y: ey } });

describe('pathLinkUnder (#451)', () => {
  it('answers the file link occupying the hyperlink cells', () => {
    const under = link('file', 3, 1, 3, 23);
    expect(pathLinkUnder(providerOf([under]), range(3, 1, 3, 23))).toBe(under);
  });

  it('answers a file link that overlaps only part of the hyperlink, across a wrap', () => {
    const under = link('file', 3, 70, 4, 12);
    expect(pathLinkUnder(providerOf([under]), range(4, 1, 4, 30))).toBe(under);
  });

  it('never answers a web link — a web url under a hyperlink is not what this recovers', () => {
    expect(pathLinkUnder(providerOf([link('web', 3, 1, 3, 23)]), range(3, 1, 3, 23))).toBeNull();
  });

  it('never answers a file link elsewhere on the row', () => {
    expect(pathLinkUnder(providerOf([link('file', 3, 40, 3, 60)]), range(3, 1, 3, 23))).toBeNull();
  });
});
