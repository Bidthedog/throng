import { afterEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import { initialFold, setSection, type HeadingRecord, type IconAsset } from '@throng/core';
import { applyFoldGutter, GUTTER_CLASS, TOGGLE_CLASS } from '../../src/renderer/preview/providers/markdown/fold-gutter.js';

/**
 * 047 T044/T045 — the Markdown preview's fold gutter and section hiding, over a plain DOM tree built
 * to look like what the pipeline + sanitiser produce: top-level `[data-heading-slug]` elements as
 * `.preview-markdown`'s direct children, followed by their content, also as direct children (the
 * pipeline never nests a paragraph inside its heading).
 *
 * `iconFor` is injected (fold-gutter.ts is plain DOM, not React) — a spy stands in for
 * `@throng/core`'s `resolveIconAsset` bound to a theme, which this file has no need to construct.
 */

function heading(level: number, slug: string, text = slug): HTMLHeadingElement {
  const el = document.createElement(`h${level}`);
  el.setAttribute('data-heading-slug', slug);
  el.setAttribute('data-source-line', '0');
  el.textContent = text;
  return el;
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function record(level: number, slug: string, line: number): HeadingRecord {
  return { level: level as HeadingRecord['level'], text: slug, slug, line };
}

const GLYPH: IconAsset = { kind: 'glyph', glyph: '#' };
const iconFor = vi.fn((_token: string): IconAsset => GLYPH);

function mount(children: HTMLElement[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'preview-markdown';
  root.append(...children);
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
  iconFor.mockClear();
});

describe("a heading's accessible name is its own text, toggle or not (FR-049)", () => {
  it('names the heading by its text, not "Collapse section …" from the toggle inside it', () => {
    // Chromium folds a child button's label into a heading's name ("Collapse section Install
    // Install" — preview-scroll.e2e.ts); jsdom's name computation does not, so the attribute that
    // pins the name is asserted directly.
    const h2 = heading(2, 'install', 'Install');
    const root = mount([h2, paragraph('body')]);
    applyFoldGutter(root, [record(2, 'install', 0)], { gutter: true, foldState: initialFold('expanded'), onToggle: vi.fn(), iconFor });

    expect(h2.getAttribute('aria-label')).toBe('Install');
    expect(within(root).getByRole('button')).toHaveAccessibleName('Collapse section Install');
  });

  it('drops the name it added once the gutter is switched off', () => {
    const h2 = heading(2, 'install', 'Install');
    const root = mount([h2]);
    const opts = { foldState: initialFold('expanded'), onToggle: vi.fn(), iconFor };
    applyFoldGutter(root, [record(2, 'install', 0)], { ...opts, gutter: true });
    applyFoldGutter(root, [record(2, 'install', 0)], { ...opts, gutter: false });

    expect(h2.hasAttribute('aria-label')).toBe(false);
    expect(within(root).getByRole('heading', { level: 2 })).toHaveAccessibleName('Install');
  });
});

describe('applyFoldGutter — the gutter (T044/T045, FR-032a/b)', () => {
  it('gutter on: inserts one button.preview-fold-toggle as the FIRST child of every shown heading', () => {
    const h1 = heading(1, 'one');
    const root = mount([h1, paragraph('body')]);
    const headings = [record(1, 'one', 0)];

    applyFoldGutter(root, headings, { gutter: true, foldState: initialFold('expanded'), onToggle: vi.fn(), iconFor });

    expect(root.classList.contains(GUTTER_CLASS)).toBe(true);
    const toggle = h1.firstElementChild;
    expect(toggle?.tagName).toBe('BUTTON');
    expect(toggle?.classList.contains(TOGGLE_CLASS)).toBe(true);
  });

  it('gutter off: no toggle inserted, no gutter class, headings and content untouched', () => {
    const h1 = heading(1, 'one');
    const root = mount([h1, paragraph('body')]);
    applyFoldGutter(root, [record(1, 'one', 0)], {
      gutter: false,
      foldState: initialFold('expanded'),
      onToggle: vi.fn(),
      iconFor,
    });

    expect(root.classList.contains(GUTTER_CLASS)).toBe(false);
    expect(root.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(0);
    expect(h1.hidden).toBe(false);
  });

  it('the toggle carries aria-expanded, an accessible name, a matching title, and is out of Tab order', () => {
    const h1 = heading(1, 'sec', 'My Section');
    const root = mount([h1]);
    applyFoldGutter(root, [record(1, 'sec', 0)], {
      gutter: true,
      foldState: initialFold('expanded'),
      onToggle: vi.fn(),
      iconFor,
    });
    const toggle = h1.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse section My Section');
    expect(toggle.title).toBe('Collapse section My Section');
    expect(toggle.tabIndex).toBe(-1);
  });

  it('a collapsed section flips aria-expanded and the icon token requested, and its label reads Expand', () => {
    const h1 = heading(1, 'sec', 'My Section');
    const root = mount([h1]);
    const collapsed = setSection(initialFold('expanded'), 'sec', true);
    iconFor.mockClear();
    applyFoldGutter(root, [record(1, 'sec', 0)], { gutter: true, foldState: collapsed, onToggle: vi.fn(), iconFor });
    const toggle = h1.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand section My Section');
    expect(iconFor).toHaveBeenCalledWith('foldPreviewCollapsed');
  });

  it('clicking a toggle calls onToggle with that heading’s slug, and never bubbles to the document', () => {
    const h1 = heading(1, 'sec');
    const root = mount([h1]);
    const onToggle = vi.fn();
    applyFoldGutter(root, [record(1, 'sec', 0)], { gutter: true, foldState: initialFold('expanded'), onToggle, iconFor });
    const toggle = h1.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('sec');
  });
});

describe('applyFoldGutter — hiding a collapsed section (T044/T045, FR-030, FR-041a)', () => {
  it('collapsing a section hides the blocks between it and the next heading, never the heading itself', () => {
    const h1 = heading(1, 'a');
    const p1 = paragraph('body of a');
    const h2 = heading(1, 'b');
    const p2 = paragraph('body of b');
    const root = mount([h1, p1, h2, p2]);
    const headings = [record(1, 'a', 0), record(1, 'b', 2)];
    const state = setSection(initialFold('expanded'), 'a', true);

    applyFoldGutter(root, headings, { gutter: false, foldState: state, onToggle: vi.fn(), iconFor });

    expect(h1.hidden).toBe(false); // the heading stays visible so the reader can re-expand it
    expect(p1.hidden).toBe(true); // its content is hidden
    expect(h2.hidden).toBe(false);
    expect(p2.hidden).toBe(false);
  });

  it('a collapsed H1 hides its H2 section entirely — heading and content both (FR-030)', () => {
    const h1 = heading(1, 'parent');
    const h2 = heading(2, 'child');
    const p2 = paragraph('child body');
    const root = mount([h1, h2, p2]);
    const headings = [record(1, 'parent', 0), record(2, 'child', 1)];
    const state = setSection(initialFold('expanded'), 'parent', true);

    applyFoldGutter(root, headings, { gutter: false, foldState: state, onToggle: vi.fn(), iconFor });

    expect(h1.hidden).toBe(false);
    expect(h2.hidden).toBe(true);
    expect(p2.hidden).toBe(true);
  });

  it('re-expanding a collapsed H1 whose H2 was independently collapsed restores the H2’s OWN state (FR-030a)', () => {
    const h1 = heading(1, 'parent');
    const h2 = heading(2, 'child');
    const p2 = paragraph('child body');
    const root = mount([h1, h2, p2]);
    const headings = [record(1, 'parent', 0), record(2, 'child', 1)];

    // The H2 was collapsed BEFORE the H1 was, so both slugs are flipped.
    let state = setSection(initialFold('expanded'), 'child', true);
    state = setSection(state, 'parent', true);
    applyFoldGutter(root, headings, { gutter: false, foldState: state, onToggle: vi.fn(), iconFor });
    expect(h2.hidden).toBe(true); // hidden by the collapsed ancestor, not by its own state alone

    // Re-expand the H1 only: the H2 comes back, but STILL collapsed (its own content stays hidden).
    const reopened = setSection(state, 'parent', false);
    applyFoldGutter(root, headings, { gutter: false, foldState: reopened, onToggle: vi.fn(), iconFor });
    expect(h1.hidden).toBe(false);
    expect(h2.hidden).toBe(false); // the H2 heading is shown again…
    expect(p2.hidden).toBe(true); // …but its own body is still hidden — the H2 was never re-expanded
  });

  it('a document with no headings at all draws no toggle and hides nothing, but the gutter class still follows the setting', () => {
    const p = paragraph('no headings here');
    const root = mount([p]);
    expect(() =>
      applyFoldGutter(root, [], { gutter: true, foldState: initialFold('expanded'), onToggle: vi.fn(), iconFor }),
    ).not.toThrow();
    expect(root.classList.contains(GUTTER_CLASS)).toBe(true); // R6: the class tracks the SETTING, not heading count
    expect(root.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(0);
    expect(p.hidden).toBe(false);
  });
});

describe('applyFoldGutter — idempotent across repeated calls on the same DOM (settings toggled with no re-render)', () => {
  it('never duplicates a toggle when called twice with gutter on', () => {
    const h1 = heading(1, 'a');
    const root = mount([h1]);
    const opts = { gutter: true, foldState: initialFold('expanded'), onToggle: vi.fn(), iconFor };
    applyFoldGutter(root, [record(1, 'a', 0)], opts);
    applyFoldGutter(root, [record(1, 'a', 0)], opts);
    expect(root.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
  });

  it('removes an existing toggle when re-called with gutter off', () => {
    const h1 = heading(1, 'a');
    const root = mount([h1]);
    applyFoldGutter(root, [record(1, 'a', 0)], {
      gutter: true,
      foldState: initialFold('expanded'),
      onToggle: vi.fn(),
      iconFor,
    });
    expect(root.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
    applyFoldGutter(root, [record(1, 'a', 0)], {
      gutter: false,
      foldState: initialFold('expanded'),
      onToggle: vi.fn(),
      iconFor,
    });
    expect(root.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(0);
  });
});
