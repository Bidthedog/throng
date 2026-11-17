/**
 * Constitution v6.7.0, "One popup style" — the app draws every `title` itself, in the shared popup style, and the OS
 * never gets the chance: while the pointer rests on a titled element its `title` is moved aside, after the OS's delay
 * the text shows as a `role="tooltip"` popup, and the attribute is back the moment the pointer leaves or presses.
 *
 * Layer: component — real pointer events over a real DOM, the attribute moves and the rendered popup; no window is
 * needed. (That the OS then draws nothing is the attribute's absence — the one thing a test can hold.)
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOVED_TITLE,
  TITLE_TOOLTIP_DELAY_MS,
  TitleTooltipHost,
  installTitleTooltips,
} from '../../src/renderer/common/title-tooltips.js';

let uninstall: (() => void) | undefined;
let button: HTMLButtonElement;
let other: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  render(createElement(TitleTooltipHost));
  uninstall = installTitleTooltips();
  button = document.createElement('button');
  button.title = 'Zoom in';
  button.innerHTML = '<span>+</span>';
  other = document.createElement('div');
  document.body.append(button, other);
});

afterEach(() => {
  uninstall?.();
  button.remove();
  other.remove();
  vi.useRealTimers();
});

const tooltip = (): HTMLElement | null => screen.queryByRole('tooltip');
/** The title the OS would draw at `el`: the nearest element, itself or an ancestor, that has the attribute at all. */
const nativeTitleAt = (el: Element): string | null => el.closest('[title]')?.getAttribute('title') ?? null;
const rest = (el: Element): void => {
  fireEvent.pointerOver(el, { clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
};

describe('a titled element under the resting pointer', () => {
  it('has its title moved aside at once, and after the delay shows it in the shared popup style', () => {
    fireEvent.pointerOver(button.firstElementChild!, { clientX: 20, clientY: 20 });
    expect(button).toHaveAttribute('title', '');
    expect(button).toHaveAttribute(MOVED_TITLE, 'Zoom in');
    expect(tooltip()).toBeNull();
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('Zoom in');
    expect(tooltip()).toHaveClass('throng-popup', 'title-tooltip');
  });

  it('gets its title back, and the tooltip goes, when the pointer leaves', () => {
    rest(button);
    fireEvent.pointerOut(button, { relatedTarget: other });
    fireEvent.pointerOver(other);
    expect(button).toHaveAttribute('title', 'Zoom in');
    expect(button).not.toHaveAttribute(MOVED_TITLE);
    expect(tooltip()).toBeNull();
  });

  it('a press hides it, and neither it nor the OS’s comes back while the pointer stays', () => {
    rest(button);
    fireEvent.pointerDown(button);
    expect(tooltip()).toBeNull();
    expect(nativeTitleAt(button), 'the OS would draw this title').toBe('');
    fireEvent.pointerMove(button, { clientX: 21, clientY: 21 });
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(nativeTitleAt(button)).toBe('');
    expect(tooltip()).toBeNull();
    // Once the pointer has left, the title is back, and the next rest is a new request.
    fireEvent.pointerOut(button, { relatedTarget: other });
    expect(button).toHaveAttribute('title', 'Zoom in');
    rest(button);
    expect(tooltip()).toHaveTextContent('Zoom in');
  });

  it('a key or a scroll hides it', () => {
    rest(button);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(tooltip()).toBeNull();
    rest(other);
    rest(button);
    fireEvent.scroll(document);
    expect(tooltip()).toBeNull();
  });

  it('a title rewritten while moved aside is moved aside again, and the new text shown', async () => {
    rest(button);
    button.setAttribute('title', 'Zoom out');
    await act(async () => {
      await Promise.resolve(); // the MutationObserver's microtask
    });
    expect(button).toHaveAttribute('title', '');
    expect(button).toHaveAttribute(MOVED_TITLE, 'Zoom out');
    expect(tooltip()).toHaveTextContent('Zoom out');
  });

  it('a title written while the pointer is already there is taken over on the next move', () => {
    other.removeAttribute('title');
    fireEvent.pointerOver(other, { clientX: 5, clientY: 5 });
    other.setAttribute('title', 'Ctrl+click to open /a/b.txt');
    fireEvent.pointerMove(other, { clientX: 6, clientY: 5 });
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(other).toHaveAttribute('title', '');
    expect(tooltip()).toHaveTextContent('Ctrl+click to open /a/b.txt');
  });

  /*
   * Reported 2026-11-16 (#637 manual testing): hovering a project row's PATH showed "Double-click to rename" twice.
   * The path has its own title inside the row's switch button, which carries "Double-click to rename". Removing the
   * path's title outright left the button's as the nearest one, so the OS drew it beside the app's tooltip. The OS
   * takes the nearest element that HAS a title attribute, and an empty one stops it — so the moved-aside element
   * keeps an empty title.
   */
  it('a title moved aside leaves an empty one, so the OS cannot fall back to an ancestor’s', () => {
    const inner = document.createElement('span');
    inner.title = '/projects/demo';
    button.appendChild(inner);
    rest(inner);
    expect(tooltip()).toHaveTextContent('/projects/demo');
    expect(nativeTitleAt(inner), 'the OS would draw this title').toBe('');
    expect(button).toHaveAttribute('title', 'Zoom in');
    fireEvent.pointerOut(inner, { relatedTarget: other });
    expect(inner).toHaveAttribute('title', '/projects/demo');
  });

  it('an element with an empty title of its own blocks its ancestors’ titles, as it does for the OS', () => {
    const mark = document.createElement('span');
    mark.title = '';
    button.appendChild(mark);
    rest(mark);
    expect(tooltip()).toBeNull();
    expect(button).toHaveAttribute('title', 'Zoom in');
  });

  it('the nearest title wins, and an element with an empty title draws nothing', () => {
    const inner = document.createElement('span');
    inner.title = 'Inner';
    button.appendChild(inner);
    rest(inner);
    expect(tooltip()).toHaveTextContent('Inner');
    expect(button).toHaveAttribute('title', 'Zoom in');

    other.title = '';
    rest(other);
    expect(tooltip()).toBeNull();
    expect(inner).toHaveAttribute('title', 'Inner');
  });
});

/*
 * Reported 2026-11-17: a terminal link's hover popup showed reliably only while throng was in the background, and once
 * shown it stayed up after the pointer left the link. The terminal has no element per link: it writes the hovered
 * link's target into its host's `title` and blanks it (`''`) when the pointer leaves the link, all under a pointer that
 * never leaves the host. These drive that exact pattern (`link-marks.ts`, "THE HOVER TITLE").
 */
describe('a title its owner changes under a resting pointer — the terminal host', () => {
  let host: HTMLDivElement;
  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve(); // the MutationObserver's microtask
    });
  };
  const hoverLink = async (target: string): Promise<void> => {
    host.title = target;
    await flush();
  };
  const leaveLink = async (): Promise<void> => {
    host.title = '';
    await flush();
  };

  beforeEach(() => {
    host = document.createElement('div');
    host.title = '';
    document.body.append(host);
    fireEvent.pointerOver(host, { clientX: 40, clientY: 40 });
  });

  afterEach(() => {
    host.remove();
  });

  it('shows the link’s target after the delay without another pointer move', async () => {
    await hoverLink('https://example.com/a');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('https://example.com/a');
    expect(nativeTitleAt(host), 'the OS would draw this title').toBe('');
  });

  it('hides at once when the pointer leaves the link, though it never left the host', async () => {
    await hoverLink('https://example.com/a');
    fireEvent.pointerMove(host, { clientX: 41, clientY: 40 });
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('https://example.com/a');
    await leaveLink();
    expect(tooltip()).toBeNull();
    // And a pending one never arrives late.
    await hoverLink('https://example.com/b');
    await leaveLink();
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toBeNull();
  });

  it('shows the next link after leaving one, each after its own delay', async () => {
    await hoverLink('https://example.com/a');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    await leaveLink();
    await hoverLink('https://example.com/b');
    expect(tooltip()).toBeNull();
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('https://example.com/b');
  });

  it('a click — the one that focuses the window — silences only the link it landed on', async () => {
    await hoverLink('https://example.com/a');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    fireEvent.pointerDown(host);
    expect(tooltip()).toBeNull();
    // xterm restates the same link on every repaint: still the pressed one, still quiet.
    await hoverLink('https://example.com/a');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toBeNull();
    // Off the link and onto another, with the pointer still inside the host.
    await leaveLink();
    fireEvent.pointerMove(host, { clientX: 60, clientY: 40 });
    await hoverLink('https://example.com/b');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('https://example.com/b');
  });

  it('typing hides it, and the next link still shows', async () => {
    await hoverLink('https://example.com/a');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    fireEvent.keyDown(host, { key: 'a' });
    expect(tooltip()).toBeNull();
    await leaveLink();
    await hoverLink('https://example.com/b');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    expect(tooltip()).toHaveTextContent('https://example.com/b');
  });

  it('leaving the host gives back the owner’s blank, not a removed attribute', async () => {
    await hoverLink('https://example.com/a');
    await leaveLink();
    fireEvent.pointerOut(host, { relatedTarget: other });
    expect(host).toHaveAttribute('title', '');
    expect(host).not.toHaveAttribute(MOVED_TITLE);
  });
});
