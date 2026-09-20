import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkHint } from '../../src/renderer/links/link-hint.js';
import { hideLinkHint, hideLinkHintFor, showLinkHint } from '../../src/renderer/links/link-hint-store.js';

/**
 * 045 FR-165, FR-166 (round four) — the one shared link hint: shown on a plain click, anchored at the
 * last row's bottom-right, clamped on screen, click-through, and hidden by every trigger FR-165d names.
 *
 * Fake timers throughout (LINK_HINT_MS is real time), so every assertion is synchronous: `act()`
 * already flushes the store's synchronous update, the re-render and the layout effect within itself —
 * `waitFor`/`findBy*` would poll with the SAME fake clock and never resolve.
 */

const ANCHOR = { left: 100, top: 100, right: 140, bottom: 120 };

function mount() {
  return render(createElement(LinkHint));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});

afterEach(() => {
  act(() => hideLinkHint());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('LinkHint — shown on a plain click (FR-165)', () => {
  it('renders nothing until a hint is shown', () => {
    mount();
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('shows the given text', () => {
    mount();
    act(() => showLinkHint({ text: 'Ctrl+Click to open in throng active editor', anchor: ANCHOR }));
    expect(screen.getByTestId('link-hint')).toHaveTextContent('Ctrl+Click to open in throng active editor');
  });

  it('is not focusable and is click-through (FR-165a)', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }));
    const el = screen.getByTestId('link-hint');
    expect(el).not.toHaveAttribute('tabindex');
    // The authored CSS carries `pointer-events: none` — asserted structurally in
    // `floating-surfaces.test.ts`'s registry, which jsdom (no stylesheet cascade) cannot itself see.
    expect(el.className).toContain('link-hint');
  });

  it('anchors at the given rect’s bottom-right — the caller supplies the last row for a multi-row link', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }));
    const el = screen.getByTestId('link-hint');
    expect(el.style.visibility).toBe('visible');
    // jsdom lays out every element at 0×0, so clampToViewport's own math (bottom-right anchor,
    // nothing to overflow) reduces to exactly the anchor's own corner.
    expect(el.style.left).toBe(`${ANCHOR.left}px`);
    expect(el.style.top).toBe(`${ANCHOR.bottom}px`);
  });

  it('clamps fully on screen when it would overflow the right or bottom edge (FR-165c)', () => {
    mount();
    const nearEdge = { left: 990, top: 790, right: 995, bottom: 795 };
    act(() => showLinkHint({ text: 'x', anchor: nearEdge }));
    const el = screen.getByTestId('link-hint');
    expect(el.style.visibility).toBe('visible');
    // jsdom measures the element at 0×0, so clampToViewport's clamp step keeps it inside
    // [0, viewport] — never negative, never past the (zero-sized) far edge.
    expect(Number.parseFloat(el.style.left)).toBeLessThanOrEqual(1000);
    expect(Number.parseFloat(el.style.left)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(el.style.top)).toBeLessThanOrEqual(800);
    expect(Number.parseFloat(el.style.top)).toBeGreaterThanOrEqual(0);
  });

  it('none where that kind is disabled (FR-165f) — the caller simply never calls showLinkHint', () => {
    // FR-165f is a property of the CALLER (T271 wires the plain-click paths), not of this component:
    // with nothing shown, nothing renders — the same first assertion above, restated for the record.
    mount();
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });
});

describe('LinkHint — never on hover, Ctrl+click or drag (FR-165e)', () => {
  it('mounting and moving the pointer alone shows nothing — only an explicit showLinkHint call does', () => {
    mount();
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.mouseOver(window);
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });
});

describe('LinkHint — at most one, replaced rather than stacked (FR-166)', () => {
  it('a second show replaces the first — never two at once', () => {
    mount();
    act(() => showLinkHint({ text: 'first', anchor: ANCHOR }));
    act(() => showLinkHint({ text: 'second', anchor: ANCHOR }));
    expect(screen.getByTestId('link-hint')).toHaveTextContent('second');
    expect(screen.getAllByTestId('link-hint')).toHaveLength(1);
  });
});

describe('LinkHint — what hides it (FR-165d)', () => {
  it('hides after LINK_HINT_MS with no other trigger', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 2_500));
    expect(screen.getByTestId('link-hint')).not.toBeNull();
    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('hides at once on a Ctrl keydown — which also covers a link Ctrl+click, since Ctrl must already be held', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.keyDown(window, { key: 'Control' });
    });
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('hides at once on window blur', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent(window, new Event('blur'));
    });
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('hides at once on a user scroll — wheel, or a scrolling key', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.wheel(window);
    });
    expect(screen.queryByTestId('link-hint')).toBeNull();

    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.keyDown(window, { key: 'PageDown' });
    });
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('a second hint replaces without ever showing two, which is FR-166’s hide-the-first half', () => {
    mount();
    act(() => showLinkHint({ text: 'first', anchor: ANCHOR }, 60_000));
    act(() => showLinkHint({ text: 'second', anchor: ANCHOR }, 60_000));
    expect(screen.getAllByTestId('link-hint')).toHaveLength(1);
  });

  it('does NOT hide while output streams and scrolls a terminal — no wheel, no scroll key, no Ctrl', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    // Simulate a terminal auto-scrolling its viewport on output: a native 'scroll' event on some
    // element, never a 'wheel' and never a keydown. The hint must still be up.
    act(() => {
      fireEvent.scroll(document.createElement('div'));
    });
    expect(screen.queryByTestId('link-hint')).not.toBeNull();
  });

  /*
   * Review round four, terminal I4 / editor L2 — FR-165d names THREE user scrolls: "wheel,
   * scrollbar, a scrolling key". The scrollbar was the one missing, and the file admitted it in its
   * own header. What tells a scrollbar drag from output scrolling a terminal is the POINTER: a drag
   * scrolls while a button is held, and output scrolls with nothing pressed at all.
   */
  /** A scrollable surface INSIDE the document — a detached node's `scroll` reaches no capture listener. */
  const scroller = (): HTMLElement => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  };

  it('hides on a scroll that happens while the pointer is held down — a scrollbar drag (FR-165d)', () => {
    mount();
    const el = scroller();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.pointerDown(el, { button: 0 });
      fireEvent.scroll(el);
    });
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('a released pointer restores the output-scroll exemption — a terminal scrolling its own viewport', () => {
    mount();
    const el = scroller();
    act(() => {
      fireEvent.pointerDown(el, { button: 0 });
      fireEvent.pointerUp(el, { button: 0 });
    });
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.scroll(el);
    });
    expect(screen.queryByTestId('link-hint')).not.toBeNull();
  });

  it('output scrolling an ATTACHED viewport with no button held still leaves the hint up', () => {
    mount();
    const el = scroller();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => {
      fireEvent.scroll(el);
    });
    expect(screen.queryByTestId('link-hint')).not.toBeNull();
  });
});

/*
 * Review round four, terminal I4 — the other two of FR-165c/FR-165d's cases the component owned and
 * did not handle: a window resize left the hint at a page position measured against the old viewport,
 * and a panel destroyed inside the 2.5 s window left its hint floating over whatever replaced it.
 */
describe('LinkHint — re-clamped on a window resize (FR-165c)', () => {
  it('re-measures against the new viewport rather than keeping a stale position', () => {
    mount();
    const nearEdge = { left: 900, top: 700, right: 940, bottom: 720 };
    act(() => showLinkHint({ text: 'x', anchor: nearEdge }, 60_000));
    const el = screen.getByTestId('link-hint');
    expect(Number.parseFloat(el.style.top)).toBe(720);

    act(() => {
      vi.stubGlobal('innerWidth', 400);
      vi.stubGlobal('innerHeight', 300);
      fireEvent(window, new Event('resize'));
    });
    expect(Number.parseFloat(el.style.left), 'clamped into the narrower viewport').toBeLessThanOrEqual(400);
    expect(Number.parseFloat(el.style.top), 'clamped into the shorter viewport').toBeLessThanOrEqual(300);
  });
});

describe('LinkHint — a destroyed owner takes its hint with it (FR-165d)', () => {
  it('hideLinkHintFor clears a hint the named panel raised', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR, owner: 'panel-a' }, 60_000));
    act(() => hideLinkHintFor('panel-a'));
    expect(screen.queryByTestId('link-hint')).toBeNull();
  });

  it('and leaves a hint another panel raised alone — one hint, but not one panel’s to hide', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR, owner: 'panel-b' }, 60_000));
    act(() => hideLinkHintFor('panel-a'));
    expect(screen.queryByTestId('link-hint')).not.toBeNull();
  });

  it('an unowned hint is never hidden by a panel closing', () => {
    mount();
    act(() => showLinkHint({ text: 'x', anchor: ANCHOR }, 60_000));
    act(() => hideLinkHintFor('panel-a'));
    expect(screen.queryByTestId('link-hint')).not.toBeNull();
  });
});
