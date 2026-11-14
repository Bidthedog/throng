/**
 * 068 T101, T102 (FR-069, FR-070) — a collapsed side pane's strip, and a minimised panel's header, restore on a click
 * anywhere on them and share one hover style: throng's own application highlight colour with its paired text colour, armed
 * only by a pointer that MOVES over the element after it collapsed (so a panel collapsed under a still pointer does not
 * flash it).
 *
 * Layer: component. jsdom paints no hover, so the look is MT-05's; this proves the wiring — the class, the arming gate and
 * the stylesheet rules that make the style — and the click.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, renderHook, screen, act } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useCollapsedHover } from '../../src/renderer/panes/use-collapsed-hover.js';
import { CollapsedRail } from '../../src/renderer/panes/collapsed-rail.js';

const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('useCollapsedHover: the flash gate', () => {
  const real = { movementX: 4, movementY: 0 };
  const props = (result: { current: ReturnType<typeof useCollapsedHover> }) => result.current;

  it('adds nothing while the element is not collapsed', () => {
    const { result } = renderHook(() => useCollapsedHover(false));
    expect(props(result).className).toBeUndefined();
    expect(props(result)['data-hover-armed']).toBeUndefined();
  });

  it('is unarmed when it collapses, and armed only by a pointer that really moves over it', () => {
    const { result } = renderHook(() => useCollapsedHover(true));
    expect(props(result).className).toBe('collapsed-hover');
    expect(props(result)['data-hover-armed']).toBe('false');
    // The synthetic move a browser sends after layout moved an element under a still pointer carries no movement.
    act(() => props(result).onPointerMove({ movementX: 0, movementY: 0 } as never));
    expect(props(result)['data-hover-armed']).toBe('false');
    act(() => props(result).onPointerMove(real as never));
    expect(props(result)['data-hover-armed']).toBe('true');
  });

  it('disarms when the pointer leaves, and shows only after it returns', () => {
    const { result } = renderHook(() => useCollapsedHover(true));
    act(() => props(result).onPointerMove(real as never));
    act(() => props(result).onPointerLeave({} as never));
    expect(props(result)['data-hover-armed']).toBe('false');
    act(() => props(result).onPointerMove(real as never));
    expect(props(result)['data-hover-armed']).toBe('true');
  });

  it('forgets an arming from an earlier collapse: minimise, hover, restore, minimise again starts unarmed', () => {
    const { result, rerender } = renderHook(({ on }) => useCollapsedHover(on), { initialProps: { on: true } });
    act(() => props(result).onPointerMove(real as never));
    expect(props(result)['data-hover-armed']).toBe('true');
    rerender({ on: false });
    rerender({ on: true });
    expect(props(result)['data-hover-armed']).toBe('false');
  });

  it('does not arm from a move while not collapsed', () => {
    const { result, rerender } = renderHook(({ on }) => useCollapsedHover(on), { initialProps: { on: false } });
    act(() => props(result).onPointerMove(real as never));
    rerender({ on: true });
    expect(props(result)['data-hover-armed']).toBe('false');
  });
});

describe('the hover style (FR-070)', () => {
  it('is gated on the armed attribute, so it never paints from :hover alone', () => {
    expect(css).toContain(".collapsed-hover[data-hover-armed='true']:hover");
    expect(css).not.toMatch(/\.collapsed-hover:hover/);
    expect(css).not.toContain('.panel--minimised > .panel__header:hover');
  });

  it('uses throng\'s application highlight and its paired text colour — never the project\'s accent', () => {
    const hover = rule(".collapsed-hover[data-hover-armed='true']:hover");
    expect(hover).toMatch(/background:\s*var\(--throng-colour-accent\)/);
    expect(hover).toMatch(/color:\s*var\(--throng-colour-accentText\)/);
    expect(hover).not.toMatch(/var\(--accent\b/);
    expect(hover).not.toContain('menuItemHoverSurface');
  });

  it('draws the title, the strip label and the controls in the paired colour so they stay readable', () => {
    const at = css.indexOf(".collapsed-hover[data-hover-armed='true']:hover :is(");
    expect(at).toBeGreaterThanOrEqual(0);
    const inner = css.slice(at, css.indexOf('}', at));
    for (const part of ['.panel__title', '.pane-rail__label', '.panel__action']) expect(inner).toContain(part);
    expect(inner).toMatch(/color:\s*var\(--throng-colour-accentText\)/);
  });

  it('shows the pointer cursor whenever the element is collapsed', () => {
    expect(rule('.collapsed-hover')).toMatch(/cursor:\s*pointer/);
  });
});

describe('the collapsed strip (FR-069)', () => {
  const strip = (onShow = vi.fn()) => {
    render(
      createElement(
        CollapsedRail,
        { testId: 'rail', label: 'Files', onShow },
        createElement('span', { 'data-testid': 'inside' }, '3'),
      ),
    );
    return onShow;
  };

  it('shows the pane on a click anywhere on it: the strip, its label, and what it carries', () => {
    const onShow = strip();
    const rail = screen.getByTestId('rail');
    fireEvent.click(rail);
    fireEvent.click(screen.getByText('Files'));
    fireEvent.click(screen.getByTestId('inside'));
    expect(onShow).toHaveBeenCalledTimes(3);
  });

  it('keeps its own class and test id and adds no tab stop; its hover is its pane\'s (FR-082)', () => {
    strip();
    const rail = screen.getByTestId('rail');
    expect(rail.className).toContain('pane-rail');
    expect(rail.className).not.toContain('collapsed-hover');
    expect(rail.getAttribute('tabindex')).toBeNull();
  });

  it('is what the main window mounts for both strips', () => {
    const app = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/app.tsx'), 'utf8');
    expect(app).toMatch(/<CollapsedRail[^>]*testId="pane-rail-left"[^>]*onShow=\{toggleLeft\}/s);
    expect(app).toMatch(/<CollapsedRail[^>]*testId="pane-rail-right"[^>]*onShow=\{toggleRight\}/s);
  });
});
