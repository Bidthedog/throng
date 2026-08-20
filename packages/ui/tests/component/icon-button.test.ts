import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../../src/renderer/common/icon-button.js';

/**
 * The one code path every action control in the application shares (constitution v3.12.0,
 * "Themeable icon controls"; 031 FR-021/FR-052/FR-052b).
 *
 * PLACE AT: `packages/ui/tests/component/icon-button.test.ts`
 * NEW COVERAGE (035). A gap scan over the renderer found 116 of 258 source files that no test
 * imports. `icon-button.tsx` has **15 dependents** — more than anything else on that list — and had
 * no test of its own.
 *
 * `icon-call-sites.test.ts` already guards that controls GO THROUGH this component. Nothing checked
 * what it then does, which is the half the constitutional rule is actually about: an icon control
 * is only acceptable because the button around it carries the name.
 *
 * ══ WHY THE ACCESSIBILITY ASSERTIONS ARE THE POINT ══
 *
 * The rule exists because a bare glyph tells a screen-reader user nothing — and today's glyph icons
 * are worse than nothing: the reader says the raw character aloud. So the contract is exact and
 * every part of it is load-bearing: the BUTTON is named, the ICON is hidden, and the BADGE is hidden
 * too, because a count is not part of what the action is called. Get any one of those wrong and the
 * control is either anonymous or announced twice.
 */

/** `Icon` reads the active theme and the icon packs; absent providers it renders its fallback. */
const button = (props: Partial<Parameters<typeof IconButton>[0]> = {}) =>
  createElement(IconButton, {
    token: 'retry',
    title: 'Try again',
    onClick: vi.fn(),
    testId: 'subject',
    ...props,
  });

describe('the control names itself, and the icon does not', () => {
  it('carries the action name as BOTH a hover title and an accessible name', () => {
    /*
     * Two different users, one string. `title` is what a pointer user reads on hover; `aria-label`
     * is what a screen reader announces. The constitution requires both because the icon supplies
     * neither, and a control with only one of them is unusable by exactly one of those two people.
     */
    render(button());

    const el = screen.getByTestId('subject');
    expect(el).toHaveAttribute('title', 'Try again');
    expect(el).toHaveAttribute('aria-label', 'Try again');
  });

  it('hides the icon from assistive technology', () => {
    // "An icon that also announced itself would be read out twice — and today's glyph icons are
    // worse than that: a screen reader reads the raw character aloud."
    render(button());

    const icon = screen.getByTestId('subject').querySelector('[aria-hidden="true"]');
    expect(icon, 'the glyph must be decorative').not.toBeNull();
  });

  it('is a button, not a div that happens to be clickable', () => {
    // `type="button"` as well: inside a form, the default `submit` would make a Try-again control
    // submit the form it sits in.
    render(button());
    expect(screen.getByTestId('subject').tagName).toBe('BUTTON');
    expect(screen.getByTestId('subject')).toHaveAttribute('type', 'button');
  });
});

describe('the badge is a quantity, never a name', () => {
  it('renders a count beside the icon and hides it from assistive technology', () => {
    /*
     * 031 FR-021: three tab-strip controls each show how many tabs they concern. That is a live
     * quantity, not a label — the action is still named by the title alone. So the badge must be
     * `aria-hidden`, or a screen reader would announce "3" as part of the control's name and the
     * name would change every time a tab opened.
     */
    render(button({ badge: 3 }));

    const badge = screen.getByTestId('subject').querySelector('.icon-button__badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    // The accessible name is unchanged by the count.
    expect(screen.getByTestId('subject')).toHaveAttribute('aria-label', 'Try again');
  });

  it('reuses the shared count pill rather than inventing a second one (FR-052b)', () => {
    // The same class the per-tab panel-count pill wears, so one visual vocabulary covers "this tab
    // holds three panels" and "three tabs are hidden that way", and a change reaches both.
    render(button({ badge: 3 }));

    expect(screen.getByTestId('subject').querySelector('.throng-count-pill')).not.toBeNull();
  });

  it('puts the count on the side the control points at (FR-052)', () => {
    /*
     * `‹ 3` reads "three that way", and so does `3 ›`. Ordering belongs to the control rather than
     * to the badge, which is why it is a flag rather than two markups — and why it is worth
     * asserting that the flag actually reorders the DOM rather than only the intent.
     */
    const { unmount } = render(button({ badge: 3, badgeFirst: true }));
    const before = [...screen.getByTestId('subject').children].map((c) => c.className);
    expect(before[0]).toContain('icon-button__badge');
    unmount();

    render(button({ badge: 3, badgeFirst: false }));
    const after = [...screen.getByTestId('subject').children].map((c) => c.className);
    expect(after[after.length - 1]).toContain('icon-button__badge');
  });

  it('draws no badge at all when there is no count', () => {
    // Distinct from a badge of zero, which a strip control legitimately shows.
    render(button());
    expect(screen.getByTestId('subject').querySelector('.icon-button__badge')).toBeNull();
  });

  it('draws a badge for a count of ZERO', () => {
    // `badge === undefined` is the absence test, deliberately, because `0` is falsy and a
    // truthiness check here would hide exactly the count a user most needs to see explained.
    render(button({ badge: 0 }));
    expect(screen.getByTestId('subject').querySelector('.icon-button__badge')).toHaveTextContent('0');
  });
});

describe('interaction', () => {
  it('calls its handler when clicked', async () => {
    const onClick = vi.fn();
    render(button({ onClick }));

    await userEvent.click(screen.getByTestId('subject'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(button({ onClick, disabled: true }));

    await userEvent.click(screen.getByTestId('subject'));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('subject')).toBeDisabled();
  });

  it('keeps its name while disabled', () => {
    /*
     * A disabled control still has to say what it is. This is the case that decides whether a
     * greyed-out button is "unavailable action X" or an anonymous grey square — and the second is
     * what a user gets if the name is ever attached conditionally.
     */
    render(button({ disabled: true }));

    expect(screen.getByTestId('subject')).toHaveAttribute('aria-label', 'Try again');
    expect(screen.getByTestId('subject')).toHaveAttribute('title', 'Try again');
  });
});

describe('dataAttrs carries state, and only state', () => {
  it('exposes host state as data attributes', () => {
    // The tab strip's `data-repeating` while a press-and-hold runs — state with no other visible
    // surface, and no other way for a test or a stylesheet to see it.
    render(button({ dataAttrs: { 'data-repeating': 'true' } }));

    expect(screen.getByTestId('subject')).toHaveAttribute('data-repeating', 'true');
  });

  it('DOES let a caller overwrite className — the comment claiming otherwise is wrong', () => {
    /*
     * A finding, recorded as a passing test of what the code actually does rather than a failing
     * test of what its comment says.
     *
     * `icon-button.tsx:61-66` states the prop is *"deliberately narrow: it carries data attributes
     * and nothing else, so it cannot be used to smuggle a second className or handler past the one
     * code path every action control shares."* Half of that holds: the type is
     * `Record<string, string>`, so a handler is a type error. But `className` IS a string, so it
     * type-checks — and `{...dataAttrs}` is spread AFTER the explicit `className`, so it wins.
     *
     * The risk is small and entirely internal; nothing in the tree does this today. It is asserted
     * here so the gap is visible in the suite rather than resting on a comment that reads as a
     * guarantee, and so that anyone who later tightens the type (e.g. a `data-${string}` key type)
     * gets a red test telling them this file records the old behaviour.
     */
    render(button({ dataAttrs: { className: 'smuggled' } as Record<string, string> }));

    expect(screen.getByTestId('subject')).toHaveClass('smuggled');
    expect(screen.getByTestId('subject')).not.toHaveClass('icon-button');
  });
});
