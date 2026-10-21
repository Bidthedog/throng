import { describe, expect, it } from 'vitest';
import { badgeLabel, renderBadge, type BadgeCanvas } from '../../src/renderer/attention/badge-renderer.js';

/**
 * The taskbar badge image (057 US3, FR-039; research R13).
 *
 * Main has no canvas, and the badge's colour must come from the theme (FR-016), so a renderer draws the
 * PNG. The drawing is separated from the DOM it runs in — the canvas and the colour lookup are passed in
 * — which is what lets the unit layer prove it: this environment has no canvas, and a fake that records
 * what was drawn says everything the contract owes (the count, the colour, the format).
 *
 * ANTI-VACUITY CONTROL: draw the count as `String(count)` and the "9+" case fails; fill with a fixed
 * colour and the colour cases fail.
 */

interface Drawn {
  fills: string[];
  texts: string[];
  size: { width: number; height: number };
  type: string | undefined;
}

function fakeCanvas(): { canvas: BadgeCanvas; drawn: Drawn } {
  const drawn: Drawn = { fills: [], texts: [], size: { width: 0, height: 0 }, type: undefined };
  let fillStyle = '';
  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    font: '',
    textAlign: '',
    textBaseline: '',
    beginPath: () => {},
    arc: () => {},
    fill() { drawn.fills.push(fillStyle); },
    fillText(text: string) { drawn.texts.push(text); drawn.fills.push(fillStyle); },
    clearRect: () => {},
  };
  const canvas: BadgeCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx as unknown as ReturnType<BadgeCanvas['getContext']>,
    toDataURL(type?: string) {
      drawn.size = { width: canvas.width, height: canvas.height };
      drawn.type = type;
      return 'data:image/png;base64,AAAA';
    },
  };
  return { canvas, drawn };
}

const colours = { attention: '#112233', failed: '#aa0000' } as const;
const deps = (canvas: BadgeCanvas) => ({
  createCanvas: () => canvas,
  colour: (kind: 'attention' | 'failed') => colours[kind],
  fallbackText: () => 'theme-accent-text',
});

describe('badgeLabel', () => {
  it.each([[1, '1'], [9, '9'], [10, '9+'], [250, '9+']])('count %i reads %s', (count, label) => {
    expect(badgeLabel(count)).toBe(label);
  });
});

describe('renderBadge', () => {
  it('draws the count and returns a PNG data URL', () => {
    const { canvas, drawn } = fakeCanvas();
    const url = renderBadge({ count: 3, kind: 'attention' }, deps(canvas));
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(drawn.type).toBe('image/png');
    expect(drawn.texts).toEqual(['3']);
  });

  it('draws 9+ above 9', () => {
    const { canvas, drawn } = fakeCanvas();
    renderBadge({ count: 12, kind: 'attention' }, deps(canvas));
    expect(drawn.texts).toEqual(['9+']);
  });

  it('is a 16 by 16 overlay icon', () => {
    const { canvas, drawn } = fakeCanvas();
    renderBadge({ count: 1, kind: 'attention' }, deps(canvas));
    expect(drawn.size).toEqual({ width: 16, height: 16 });
  });

  it('fills with the theme’s Attention colour for an Attention badge', () => {
    const { canvas, drawn } = fakeCanvas();
    renderBadge({ count: 1, kind: 'attention' }, deps(canvas));
    expect(drawn.fills).toContain(colours.attention);
    expect(drawn.fills).not.toContain(colours.failed);
  });

  it('fills with the theme’s Failed colour for a Failed badge (FR-039: Failed wins)', () => {
    const { canvas, drawn } = fakeCanvas();
    renderBadge({ count: 1, kind: 'failed' }, deps(canvas));
    expect(drawn.fills).toContain(colours.failed);
    expect(drawn.fills).not.toContain(colours.attention);
  });

  it('writes the count in the theme’s fallback text colour when the mark colour is not a hex it can judge', () => {
    const { canvas, drawn } = fakeCanvas();
    renderBadge({ count: 2, kind: 'attention' }, { ...deps(canvas), colour: () => 'rgb(10, 20, 30)' });
    expect(drawn.fills).toContain('theme-accent-text');
  });

  it('rejects when the environment cannot draw, rather than answering an empty image', () => {
    const { canvas } = fakeCanvas();
    canvas.getContext = () => null as never;
    expect(() => renderBadge({ count: 1, kind: 'attention' }, deps(canvas))).toThrow(/canvas/i);
  });
});
