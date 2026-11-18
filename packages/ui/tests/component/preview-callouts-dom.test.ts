import { afterEach, describe, expect, it } from 'vitest';
import type { IconKey } from '@throng/core';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import {
  CALLOUT_COLLAPSED_ATTRIBUTE,
  CALLOUT_FOLD_CONTROL_CLASS,
  createCalloutFolds,
  revealCalloutsAt,
} from '../../src/renderer/preview/providers/markdown/callout-dom.js';
import { buildPreviewTextModel } from '../../src/renderer/preview/preview-search-model.js';
import { captureSelection, selectAllIn } from '../../src/renderer/preview/copy.js';

/**
 * 075 FR-001 – FR-010, FR-024, SC-003 — what the body's callout pass does to the sanitised DOM: icons, fold
 * controls, keyboard, fold state across re-renders, and reveal.
 *
 * Layer: component — the subject is DOM the pass builds and the events it answers (jsdom).
 */
const iconFor = (key: IconKey): string => `<svg data-icon="${key}"></svg>`;

let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

/** Render `text`, decorate it with `folds`, and mount it in the document. */
function draw(text: string, folds = createCalloutFolds()): { root: HTMLElement; folds: ReturnType<typeof createCalloutFolds> } {
  const fragment = createMarkdownRenderer().render(text).fragment;
  folds.decorate(fragment, text, iconFor);
  const root = document.createElement('div');
  root.className = 'preview-markdown';
  root.append(fragment);
  document.body.append(root);
  folds.attach(root);
  mounted.push(root);
  return { root, folds };
}

const callout = (root: ParentNode, n = 0): HTMLElement => root.querySelectorAll<HTMLElement>('[data-callout]')[n];
const titleRow = (el: HTMLElement): HTMLElement => el.querySelector(':scope > [data-callout-title]') as HTMLElement;
const collapsed = (el: HTMLElement): boolean => el.hasAttribute(CALLOUT_COLLAPSED_ATTRIBUTE);

describe('icons and titles (FR-001, FR-002, FR-024)', () => {
  it('draws each callout\'s icon by its canonical type\'s key', () => {
    const { root } = draw('> [!check] Done\n> x\n\n> [!caution]\n> y\n');
    expect(callout(root, 0).querySelector('[data-callout-icon] svg')?.getAttribute('data-icon')).toBe('calloutSuccess');
    expect(callout(root, 1).querySelector('[data-callout-icon] svg')?.getAttribute('data-icon')).toBe('calloutWarning');
    expect(callout(root, 0).querySelector('[data-callout-icon]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows no literal marker anywhere', () => {
    const { root } = draw('> [!info] Clarification\n> body\n');
    expect(root.textContent).not.toContain('[!');
    expect(titleRow(callout(root)).textContent).toBe('Clarification');
  });

  it('redraws icons from a new resolver (an icon set or theme change)', () => {
    const { root, folds } = draw('> [!bug]\n> x\n');
    folds.refreshIcons(root, (key) => `<svg data-icon="${key}-v2"></svg>`);
    expect(callout(root).querySelector('[data-callout-icon] svg')?.getAttribute('data-icon')).toBe('calloutBug-v2');
  });
});

describe('folding (FR-006, FR-007)', () => {
  it('starts `-` collapsed, `+` expanded, and leaves an unsigned callout unfoldable', () => {
    const { root } = draw('> [!tip]- A\n> a\n\n> [!tip]+ B\n> b\n\n> [!tip] C\n> c\n');
    expect(collapsed(callout(root, 0))).toBe(true);
    expect(collapsed(callout(root, 1))).toBe(false);
    expect(titleRow(callout(root, 0)).getAttribute('aria-expanded')).toBe('false');
    expect(titleRow(callout(root, 1)).getAttribute('aria-expanded')).toBe('true');
    const fixed = titleRow(callout(root, 2));
    expect(fixed.hasAttribute('tabindex')).toBe(false);
    expect(fixed.hasAttribute('role')).toBe(false);
    expect(fixed.querySelector(`.${CALLOUT_FOLD_CONTROL_CLASS}`)).toBeNull();
  });

  it('gives a foldable title row focus, a button role, a hover and the fold icon keys', () => {
    const { root } = draw('> [!tip]- A\n> a\n');
    const row = titleRow(callout(root));
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('title')).toBe('Expand callout');
    expect(row.querySelector(`.${CALLOUT_FOLD_CONTROL_CLASS} svg`)?.getAttribute('data-icon')).toBe('foldPreviewCollapsed');
  });

  it('toggles on a click on the title row', () => {
    const { root } = draw('> [!tip]- A\n> a\n');
    titleRow(callout(root)).click();
    expect(collapsed(callout(root))).toBe(false);
    expect(titleRow(callout(root)).getAttribute('title')).toBe('Collapse callout');
    expect(titleRow(callout(root)).querySelector(`.${CALLOUT_FOLD_CONTROL_CLASS} svg`)?.getAttribute('data-icon')).toBe('foldPreviewExpanded');
    titleRow(callout(root)).click();
    expect(collapsed(callout(root))).toBe(true);
  });

  it('toggles on Enter and Space while the title row has focus (SC-003)', () => {
    const { root } = draw('> [!tip]- A\n> a\n');
    const row = titleRow(callout(root));
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(collapsed(callout(root))).toBe(false);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    row.dispatchEvent(space);
    expect(collapsed(callout(root))).toBe(true);
    expect(space.defaultPrevented).toBe(true);
  });

  it('does not toggle when a link in the title is clicked', () => {
    const { root } = draw('> [!tip]- See [this](https://example.com)\n> a\n');
    const link = titleRow(callout(root)).querySelector('a') as HTMLElement;
    link.click();
    expect(collapsed(callout(root))).toBe(true);
  });

  it('folds nested callouts independently, three deep', () => {
    const { root } = draw('> [!example]+ Outer\n> > [!warning]- Middle\n> > > [!bug]- Inner\n> > > deep\n');
    titleRow(callout(root, 1)).click();
    titleRow(callout(root, 2)).click();
    expect([0, 1, 2].map((n) => collapsed(callout(root, n)))).toEqual([false, false, false]);
    titleRow(callout(root, 0)).click();
    expect([0, 1, 2].map((n) => collapsed(callout(root, n)))).toEqual([true, false, false]);
  });
});

describe('fold state is view state (FR-008, FR-009)', () => {
  it('survives a re-render of the same document, including an edit elsewhere', () => {
    const folds = createCalloutFolds();
    const first = draw('Intro\n\n> [!tip]- A\n> a\n', folds);
    titleRow(callout(first.root)).click();
    const second = draw('Intro, edited\n\nMore\n\n> [!tip]- A\n> a\n', folds);
    expect(collapsed(callout(second.root))).toBe(false);
  });

  it('starts from the new sign when the marker\'s sign changes', () => {
    const folds = createCalloutFolds();
    const first = draw('> [!tip]- A\n> a\n', folds);
    titleRow(callout(first.root)).click();
    const second = draw('> [!tip]+ A\n> a\n', folds);
    expect(collapsed(callout(second.root))).toBe(false);
    titleRow(callout(second.root)).click();
    const third = draw('> [!tip]- A\n> a\n', folds);
    expect(collapsed(callout(third.root))).toBe(true);
  });

  it('starts from the signs again after a reset (a different file)', () => {
    const folds = createCalloutFolds();
    titleRow(callout(draw('> [!tip]- A\n> a\n', folds).root)).click();
    folds.reset();
    expect(collapsed(callout(draw('> [!tip]- A\n> a\n', folds).root))).toBe(true);
  });
});

describe('find and copy (FR-011, edge case Copy)', () => {
  it('finds the title and body text, never the marker or the throng-drawn controls', () => {
    const { root } = draw('> [!caution]- Mind the gap\n> upkeep matters\n');
    const model = buildPreviewTextModel(root);
    expect(model.text).toContain('Mind the gap');
    expect(model.text).toContain('upkeep matters');
    expect(model.text).not.toContain('[!');
    expect(model.text).not.toContain('caution');
  });

  it('copies a selected callout as its title and body, with no marker and no controls', () => {
    const { root } = draw('> [!tip]+ Title\n> Body\n');
    selectAllIn(root);
    const captured = captureSelection(root);
    expect(captured?.text.replace(/\s+/g, ' ').trim()).toBe('Title Body');
    expect(captured?.fragment.querySelector('.preview-callout__fold, .preview-callout__icon')).toBeNull();
  });
});

describe('reveal (FR-010)', () => {
  it('opens every collapsed callout around a node, and nothing else', () => {
    const { root } = draw('> [!example]- Outer\n> > [!warning]- Inner\n> > needle\n\n> [!tip]- Other\n> x\n');
    const needle = [...root.querySelectorAll('p')].find((p) => p.textContent === 'needle') as HTMLElement;
    expect(revealCalloutsAt(needle.firstChild as Node)).toBe(true);
    expect(collapsed(callout(root, 0))).toBe(false);
    expect(collapsed(callout(root, 1))).toBe(false);
    expect(collapsed(callout(root, 2))).toBe(true);
    expect(revealCalloutsAt(needle)).toBe(false);
  });

  it('remembers what a reveal opened across a re-render', () => {
    const folds = createCalloutFolds();
    const { root } = draw('> [!tip]- A\n> needle\n', folds);
    revealCalloutsAt(root.querySelector('[data-callout-body] p') as Node);
    expect(collapsed(callout(draw('> [!tip]- A\n> needle\n', folds).root))).toBe(false);
  });
});
