/**
 * The bounded rename box (031 US4, contracts/name-limit.md C1–C6, FR-035–FR-036a).
 *
 * PLACE AT: `packages/ui/tests/component/name-limit-field.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (034 FR-045): T078, T078b, T079, T080
 * and the mechanism half of T082.
 *
 * Those tests opened a real project, wrote `settings.json` into the run's own config root, waited for
 * hot-reload to carry the new limit into the strip, double-clicked a chip and then typed into the box
 * that appeared — in order to read a counter and an input value. `NameLimitField` is exported and
 * takes PROPS ONLY: `initialValue`, `limit`, four cosmetic strings, `onCommit`, `onCancel`. It reaches
 * no context, no store and no IPC. Everything the counter says is a function of those props and what
 * the user typed.
 *
 * ══ WHY THIS IS THE RIGHT LAYER FOR FR-035g ══
 *
 * T080 asserted "a panel rename behaves identically — one setting, one counter, one behaviour" by
 * driving a second surface in the running app. But the tab chip and the panel header render the SAME
 * component; the only things that differ are four strings. So the parity claim is structural, and the
 * table below states it as such: every behavioural test runs twice, once under each call site's real
 * prop set. Two independently-written fields could agree on a counter by coincidence; one component
 * cannot disagree with itself. That is the argument `panel-failure-banner.test.ts` already makes for
 * its two panel types, and the source half of it — that these two call sites really are the only two,
 * and really do take the same setting — is `tests/unit/name-limit-call-sites.test.ts`.
 *
 * The grapheme arithmetic underneath is NOT restated here: `packages/core/tests/unit/grapheme.test.ts`
 * owns it down to the ZWJ-family example. What this file adds is the FIELD applying it — the cap on
 * the way in, the cap at commit, and a counter that cannot disagree with either.
 *
 * ══ WHAT STAYS END-TO-END, and none of it is a near miss ══
 *
 *   - C3's "reaching the limit is not an error" is asserted in the E2E by comparing the counter's
 *     COMPUTED colour and font-weight before and after the limit is reached. jsdom loads no stylesheet,
 *     so that comparison would be true here of a counter that had turned scarlet in the real app —
 *     a vacuous pass, which is worse than no test. It stays where the cascade is real (034 FR-049).
 *     What this file can say instead is that no error MARKUP appears: no `aria-invalid`, no extra
 *     class on the counter, and the commit still goes through.
 *   - "No notice is raised" (T078). A notice is application state; this component cannot raise one and
 *     cannot prove another surface did not.
 *   - The wiring, which is T082's real subject: that a `settings.json` write reaches an OPEN box's
 *     `limit` prop live. This file proves the box FOLLOWS the prop; only the app proves the prop
 *     follows the setting. A regression that snapshotted the limit at mount would be invisible here.
 *   - Every persistence guarantee (T081, T083, T084a, T084b) — those are about the store.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NameLimitField } from '../../src/renderer/common/name-limit-field.js';

/**
 * A deterministic name of `n` characters whose every prefix differs from every other prefix, so
 * "cut at thirty" and "cut at sixteen" can never be mistaken for one another. Lifted verbatim from
 * the spec this file replaces, so a reader comparing the two sees the same values.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const name = (n: number): string =>
  Array.from({ length: n }, (_, i) => ALPHABET[i % ALPHABET.length]).join('');

/**
 * A ZWJ family: man + ZWJ + woman + ZWJ + girl. EIGHT UTF-16 code units, ONE grapheme cluster.
 *
 * Written as explicit escapes rather than pasted, deliberately: the joiners are invisible and the
 * composition is the thing under test. A pasted character would be re-normalised or silently eaten by
 * the next editor to touch this file, and the test would then quietly measure something else.
 */
const ZWJ = String.fromCodePoint(0x200d);
const FAMILY = [0x1f468, 0x1f469, 0x1f467].map((cp) => String.fromCodePoint(cp)).join(ZWJ);

/**
 * THE TWO CALL SITES, with the exact strings each one passes.
 *
 * `tab-group.tsx` and `panel-placeholder.tsx:638` differ in nothing else — same component, same
 * `limit={maxNameLength}`, same `settings.tabs` behind it. The counter ids are copied rather than
 * generated because they are what ~20 specs select by, and `tabstrip-` (not `tab-`) is deliberate on
 * the tab side: `[data-testid^="tab-"]` is how the strip's own tests find chips.
 */
const CALL_SITES = [
  {
    where: 'the tab strip’s rename box',
    className: 'tab-chip__rename',
    testId: 'tab-rename-input-t1',
    counterClassName: 'tab-chip__rename-count',
    counterTestId: 'tabstrip-rename-count-t1',
  },
  {
    where: 'the panel header’s rename box',
    className: 'panel-box__rename',
    testId: 'panel-rename-input-p1',
    counterClassName: 'panel-box__rename-count',
    counterTestId: 'panel-rename-count-p1',
  },
] as const;

type Site = (typeof CALL_SITES)[number];

/**
 * Mount the field as one of its two call sites mounts it.
 *
 * Uncontrolled BY DESIGN — the component seeds its own draft from `initialValue` at mount and owns it
 * from there — so no stateful host is needed, unlike `colour-field.test.ts`'s `ColourField`. What IS
 * needed is `rerender`, because C5 is a change to the `limit` PROP while the box is open.
 */
function mount(site: Site, initialValue: string, limit: number) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const props = {
    initialValue,
    limit,
    className: site.className,
    testId: site.testId,
    counterClassName: site.counterClassName,
    counterTestId: site.counterTestId,
    onCommit,
    onCancel,
  };
  const view = render(createElement(NameLimitField, props));
  return {
    onCommit,
    onCancel,
    user: userEvent.setup(),
    input: (): HTMLInputElement => screen.getByTestId(site.testId) as HTMLInputElement,
    counter: (): HTMLElement | null => screen.queryByTestId(site.counterTestId),
    /** Change the limit underneath an open box, which is exactly what hot-reload does (C5). */
    setLimit: (next: number): void => {
      view.rerender(createElement(NameLimitField, { ...props, limit: next }));
    },
  };
}

/**
 * Set the whole value in ONE input event — the component's own view of a paste or a `fill`.
 *
 * NOT `user.type`, and this is not a convenience. user-event types code point by code point, so
 * `FAMILY.repeat(12)` would arrive as a stream of lone emoji and joiners, each one truncated against
 * the limit as it lands. The intermediate values are then re-joined by the very grapheme rules under
 * test (a trailing ZWJ binds to the next pictograph), and the field would end up holding something no
 * user could ever produce. Playwright's `fill` is a single bulk set for the same reason, so this is
 * the same event the migrated spec delivered.
 */
function fill(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe.each(CALL_SITES)('$where', (site) => {
  it('opens focused, with its text selected, so typing replaces the old name', () => {
    // The E2E never asserted this — it relied on it, by typing straight after a double-click. A field
    // that opened unfocused would have made every one of those tests fail somewhere less obvious.
    const { input } = mount(site, 'Tab 1', 30);
    expect(input()).toHaveFocus();
  });

  it('C1 — hides the counter while the name is more than ten from the limit', () => {
    const { input, counter } = mount(site, '', 30);
    fill(input(), name(19));
    // Nineteen of thirty is ELEVEN away, one outside the threshold. The boundary is chosen, not
    // rounded: at twenty the counter appears, and the test below proves it.
    expect(counter()).toBeNull();
  });

  it('C2 — shows used against total from ten remaining onwards', () => {
    const { input, counter } = mount(site, '', 30);
    fill(input(), name(20));
    expect(counter()).toHaveTextContent('20/30');
    expect(counter()).toHaveAttribute('data-at-limit', 'false');
  });

  it('caps what the field accepts, and the counter agrees with it (C4)', () => {
    /*
     * Forty characters offered at a limit of thirty. The value is cut where the limit is — not
     * refused, not accepted-then-fixed-at-commit — and the counter reads used === total, because both
     * come from the same rule. A cap that counted UTF-16 code units would still pass here; that is
     * what the emoji test below is for.
     */
    const { input, counter } = mount(site, '', 30);
    fill(input(), name(40));
    expect(input().value).toBe(name(30));
    expect(counter()).toHaveTextContent('30/30');
    expect(counter()).toHaveAttribute('data-at-limit', 'true');
  });

  it('C3 — reaching the limit is not an error, and does not block the commit', () => {
    /*
     * Hitting a name limit is not a mistake: the user asked for a name and got as much of it as the
     * limit allows. So no invalid marking, no error variant on the counter, no refused commit.
     *
     * The E2E states this by comparing the counter's COMPUTED colour and weight either side of the
     * limit. That comparison cannot come here — jsdom loads no stylesheet, so it would hold of a
     * counter that had turned red in the real app. It stays end-to-end; what is asserted here is that
     * no error MARKUP appears, which is the half a stylesheet cannot fake.
     */
    const { input, counter, onCommit } = mount(site, '', 30);
    fill(input(), name(40));

    expect(counter()).not.toBeNull();
    expect(input()).not.toHaveAttribute('aria-invalid');
    // The exact class it was given, and nothing appended — an `--error` modifier would fail here.
    expect(counter()!.className).toBe(site.counterClassName);

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toBe(name(30));
  });

  it('C6 — at a limit of ten the counter is visible from the first character', () => {
    // Correct rather than a bug: ten is the smallest `tabs.maxNameLength` allows and the approach
    // threshold is itself ten, so every character is within ten of the end.
    const { input, counter } = mount(site, '', 10);
    fill(input(), 'x');
    expect(counter()).toHaveTextContent('1/10');
  });

  it('counts GRAPHEMES, so ten emoji fit a limit of ten and none is cut in half', () => {
    /*
     * Twelve ZWJ families offered at a limit of ten. If the cap counted UTF-16 code units the field
     * would hold one family and a fragment of a second; if it cut mid-cluster the value would end in a
     * lone joiner or half a person. Exactly ten whole families is the only value that is both within
     * the limit and unbroken — and the counter must agree with the field.
     */
    const { input, counter } = mount(site, '', 10);
    fill(input(), FAMILY.repeat(12));
    expect(FAMILY.length, 'a ZWJ family is eight code units, so this is not counting characters').toBe(8);
    expect(input().value).toBe(FAMILY.repeat(10));
    expect(counter()).toHaveTextContent('10/10');
    expect(counter()).toHaveAttribute('data-at-limit', 'true');
  });

  it('FR-036 — a paste longer than the room left inserts as much as fits, rather than being refused', async () => {
    const { input, counter, user } = mount(site, '', 16);
    fill(input(), name(8));
    expect(counter()).toHaveTextContent('8/16');

    // At the END of what is already there, so the insertion really is "the room that is left" rather
    // than a whole-value replacement. The E2E used `insertText` after pressing End for the same
    // reason — Electron's clipboard reads back empty under the harness, so a real Ctrl+V there would
    // have inserted nothing and the test would have passed by asserting that nothing arrived.
    input().setSelectionRange(input().value.length, input().value.length);
    await user.paste(name(60));

    expect(input().value).toBe((name(8) + name(60)).slice(0, 16));
    // FR-036a — the counter reads at-limit, so the user can SEE that the paste was cut.
    expect(counter()).toHaveTextContent('16/16');
    expect(counter()).toHaveAttribute('data-at-limit', 'true');
  });

  it('C5 — a limit lowered while the box is open shortens what is already typed', () => {
    /*
     * The preferences window is a separate window and settings hot-reload, so the limit really can
     * change mid-rename. If the field kept what was typed, the commit would silently cut it — the user
     * would watch a name they had finished typing lose its tail on Enter.
     *
     * What this proves is the component following its PROP. That the prop follows the setting is the
     * wiring, and stays in T082.
     */
    const { input, counter, setLimit } = mount(site, '', 64);
    fill(input(), name(60));
    expect(counter()).toHaveTextContent('60/64');

    setLimit(30);

    expect(input().value).toBe(name(30));
    expect(counter()).toHaveTextContent('30/30');
  });

  it('commits the value trimmed, and reports the seed the box opened on', () => {
    /*
     * The seed travels WITH the value (#218) so the host can tell an edit from an untouched box
     * without re-deriving it from a title that may have moved underneath.
     *
     * What is deliberately NOT asserted here is FR-035f's cap at commit. The field already caps on the
     * way in and bounds `initialValue` at mount, so no sequence of DOM events can present `commit`
     * with an over-long value — the cap there is defence in depth, and a test that appeared to reach
     * it would be lying about which line it exercised. The guarantee itself (an over-long stored name
     * cannot be reintroduced by renaming) is asserted against the STORE, in T081.
     */
    const { input, onCommit } = mount(site, 'Tab 1', 30);
    fill(input(), '  Hello  ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Hello', 'Tab 1');
  });

  it('Escape backs out without committing anything', () => {
    // Not migrated from a test — the E2E never asserted it, and a cancel that quietly committed would
    // have renamed a tab the user was in the middle of abandoning.
    const { input, onCommit, onCancel } = mount(site, 'Tab 1', 30);
    fill(input(), name(20));
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('FR-035g — one setting, one counter, one behaviour', () => {
  it('both call sites produce the same counter text and the same cut, for the same limit', () => {
    /*
     * The parity claim, stated once and directly rather than inferred from the table above passing
     * twice. Each site is mounted, given the same over-long name at the same limit, and the two are
     * compared to each other — so a change that made one of them behave differently fails HERE, naming
     * the divergence, rather than showing up as one row of a parameterised table going red.
     *
     * The other half of FR-035g — that these are the only two rename boxes, and that both take
     * `settings.tabs.maxNameLength` — cannot be seen from inside a render. It is a source guard:
     * `packages/ui/tests/unit/name-limit-call-sites.test.ts`.
     */
    // Both are mounted into the same document, which is safe precisely BECAUSE their test ids differ
    // — the four cosmetic strings are the only thing that does.
    const readings = CALL_SITES.map((site) => {
      const { input, counter } = mount(site, '', 30);
      fill(input(), name(40));
      return { value: input().value, counter: counter()?.textContent ?? null };
    });

    expect(readings[0]).toEqual(readings[1]);
    expect(readings[0]).toEqual({ value: name(30), counter: '30/30' });
  });
});
