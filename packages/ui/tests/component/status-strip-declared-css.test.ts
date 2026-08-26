/**
 * The two declarations that make the bar's layout work (040 US2 — FR-013, FR-020).
 *
 * ══ WHY A CSS ASSERTION IS THE ONLY THING THAT CAN CATCH THIS ══
 *
 * FR-013 says the readouts are left-aligned and the language indicator and wrap toggle are
 * right-aligned. `status-strip-fit-wiring.test.ts` proves the two GROUPS exist and that each thing
 * is in the right one — and that is all a component test can prove, because jsdom has no layout.
 * Group membership is satisfied identically by `justify-content: flex-end`, which draws both groups
 * hard right and leaves FR-013 unimplemented while every test in the suite is green.
 *
 * `editor-status-bar.e2e.ts` measures that the two groups do not overlap — which `flex-end` also
 * satisfies. So there is a real gap between "the tree is right" and "the pixels are right", and one
 * declared keyword is what closes it.
 *
 * ══ FOLLOWING `notice-pointer-events.test.ts`, INCLUDING ITS LIMITS ══
 *
 * That file is the precedent for asserting CSS at this tier, and it earns it in three steps this
 * one repeats: load the application's own stylesheet so the cascade is throng's; prove the sheet
 * parsed, so "the CSS was never there" cannot pass as a green bar; and assert only what jsdom
 * resolves faithfully.
 *
 * That last constraint is why nothing here reads a COLOUR, and why the only length it reads is a
 * literal one. **jsdom does not substitute `var()`** — a declaration written as
 * `var(--throng-colour-x, #151a23)` comes back as that literal string. `nowrap` and `space-between`
 * are bare keywords on a plain class selector, which is the one thing this environment answers
 * correctly, and so is `gap: 6px`, which no variable stands between.
 *
 * ══ AND WHY THERE IS NO HEIGHT ASSERTION ══
 *
 * FR-020 says the bar is exactly one line high. The rule already declares `min-height: 20px`, so an
 * assertion about it would be green the moment it was written and would prove nothing about
 * wrapping. What makes the bar one line is `nowrap` plus the fit logic, and the MEASURED claim —
 * that the height does not move across a resize and the text area's height does not either — is
 * `editor-status-bar.e2e.ts` under `@reserve:layout`, where a real layout engine exists.
 *
 * `min-height` also must not become a fixed `height`: the comment beside it in `editor.css` records
 * that the language picker pops UPWARD out of a 20px bar and a hard height would clip it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BAR_GAP } from '../../src/renderer/editor/status-strip.js';

/*
 * Resolved from the runner's root rather than from `import.meta.url`: under jsdom the module URL is
 * an `http://localhost/` one and `fileURLToPath` rejects it outright. Vitest runs every project with
 * the repository root as its working directory, and the `existsSync` guard turns a future move of
 * this file into a named failure rather than an empty stylesheet.
 */
const EDITOR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/editor/editor.css');

let sheet: HTMLStyleElement;
let probe: HTMLDivElement;
let controls: HTMLDivElement;

beforeAll(() => {
  expect(existsSync(EDITOR_CSS), `editor.css was not found at ${EDITOR_CSS}`).toBe(true);
  sheet = document.createElement('style');
  sheet.textContent = readFileSync(EDITOR_CSS, 'utf8');
  document.head.appendChild(sheet);

  probe = document.createElement('div');
  probe.className = 'editor-status-strip';
  document.body.appendChild(probe);

  // The trailing group, on its own probe: the FR-014 declarations below are on the MODIFIER class,
  // and a probe carrying only the base class would read the base rule and pass for the wrong reason.
  controls = document.createElement('div');
  controls.className = 'editor-status-strip__group editor-status-strip__group--controls';
  probe.appendChild(controls);
});

afterAll(() => {
  sheet.remove();
  probe.remove();
});

const declared = (property: string): string => getComputedStyle(probe).getPropertyValue(property);
const declaredOnControls = (property: string): string =>
  getComputedStyle(controls).getPropertyValue(property);

/* ────────────────────────────────────────────────────────────────────────── *
 * Anti-vacuity: the sheet really is loaded
 * ────────────────────────────────────────────────────────────────────────── */

describe('the stylesheet under test actually parsed', () => {
  it('applies a rule from editor.css to the probe element', () => {
    /*
     * Every assertion below is `getComputedStyle` on one class. If the sheet failed to load, or the
     * selector were renamed, each of them would read a user-agent default and the file would report
     * green while proving nothing. This is what makes that impossible: `display: flex` is declared
     * on `.editor-status-strip` and is not any element's default.
     */
    expect(declared('display'), 'editor.css did not reach the probe element').toBe('flex');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-013 — the split that puts the readouts left and the controls right
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar is split by alignment (FR-013)', () => {
  it('declares space-between, not flex-end', () => {
    /*
     * The shipped value was `flex-end`, which is right for the bar 016 built — one right-aligned
     * language label — and wrong for the bar this feature builds. With `flex-end` both groups sit
     * hard right and the readouts are nowhere near the left edge FR-013 requires, while every
     * structural test still passes.
     */
    expect(declared('justify-content')).toBe('space-between');
  });

  it('has not simply moved the old alignment onto a group', () => {
    // The other way to get the tree right and the pixels wrong: leave the strip at `flex-end` and
    // push the readouts with a margin. The requirement is that the pressure is absorbed BETWEEN
    // the two groups (FR-014), which is what `space-between` says and a margin does not.
    expect(declared('justify-content')).not.toBe('flex-end');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-014 — the trailing group is measured at what it COSTS
 * ────────────────────────────────────────────────────────────────────────── */

describe('the trailing group does not give way (FR-014)', () => {
  it('declares flex-shrink: 0, so its measured width is intrinsic', () => {
    /*
     * ══ THE DEFECT THIS CLOSES ══
     *
     * `status-strip.tsx` measures this group and hands the remainder to the readouts:
     * `available = bar - controls - gap`. `.editor-status-strip__group` declares `min-width: 0` and
     * takes the default `flex: 0 1 auto`, so without this one declaration the group SHRINKS — and
     * `getBoundingClientRect().width` then reports the width the READOUTS left over, which is a
     * function of the number that was computed from it.
     *
     * It settles at a stable wrong answer rather than oscillating, which is why every test in the
     * suite stayed green. At a width where five readouts just fit, changing the language from
     * `Plain Text` to something longer leaves the measurement at the old smaller value: nothing
     * gives way, the bar overflows, and the next measurement reads the shrunk group and agrees. The
     * language ellipsises under readouts painting over it — FR-014 inverted, since the requirement
     * says the READOUTS give way.
     *
     * This is here rather than only in `status-strip-fit-wiring.test.ts` for the reason this whole
     * file exists: the component test can prove the bar honours whatever it measures, and only the
     * cascade decides what the measurement means.
     */
    expect(
      declaredOnControls('flex-shrink'),
      'without this the measured controls width is a function of the readouts it sizes',
    ).toBe('0');
  });

  it('still declares a max-width, so FR-022b survives it', () => {
    /*
     * The other half, and the one a reader would delete as redundant. A group that can NEVER give
     * way overflows the panel outright once the language name alone is wider than the bar — spilling
     * past the panel's right edge instead of ellipsising, which FR-022b forbids.
     *
     * A percentage, and that is the load-bearing part rather than the number: it resolves against
     * the STRIP's content box, so the clamp depends on the panel's width and never on the readouts.
     * A `max-width` expressed in terms of the readouts would reintroduce exactly the loop above.
     */
    expect(declaredOnControls('max-width')).toBe('100%');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-020 — one line, never wrapped
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar never wraps (FR-020)', () => {
  it('declares white-space: nowrap on the strip itself', () => {
    /*
     * Declared on the STRIP rather than only on each readout, so it is inherited by everything the
     * bar ever contains — including anything added later by someone who did not read this file. A
     * bar that wrapped would grow a second line, and the editor's text area would shrink because
     * the user dragged a splitter sideways, which is what SC-002 forbids.
     */
    expect(declared('white-space')).toBe('nowrap');
  });

  it('still declares a MINIMUM height rather than a fixed one', () => {
    /*
     * Not a height assertion — a rule about which PROPERTY is used, and it is here because the
     * obvious way to enforce "exactly one line high" is `height: 20px`, which would clip the
     * language picker: the picker pops upward out of the bar, and `editor.css` says so beside the
     * rule. `min-height` is deliberate and this is what stops it being "tidied" into `height`.
     */
    expect(declared('min-height')).toBe('20px');
    expect(declared('height'), 'a fixed height would clip the language picker').not.toBe('20px');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * T044a — the one number the stylesheet and the fit arithmetic BOTH hold
 * ────────────────────────────────────────────────────────────────────────── */

describe('the declared gap and BAR_GAP agree (T044a)', () => {
  it('declares the gap the fit arithmetic assumes', () => {
    /*
     * `BAR_GAP` in `status-strip.tsx` is `gap: 6px` here, written twice. That duplication is
     * deliberate — the fit arithmetic needs a number, and reading it back through `getComputedStyle`
     * would cost a cascade query per resize for a value unchanged since 016 — but until this
     * assertion existed it was UNGUARDED: change the stylesheet alone and the bar keeps deciding
     * what fits using a gap the browser is no longer drawing, so it hides a readout too early or
     * overflows by a few pixels, with every test in the suite still green.
     *
     * A length, unlike everything else in this file, because it is a literal `6px` on a plain class
     * selector rather than a `var()` — which jsdom would hand back unresolved. That is why the
     * assertion is written as a comparison against the parsed number and not against `'6px'`: it is
     * pinning the two declarations to each other, not pinning either to six.
     */
    const declaredGap = declared('gap');
    expect(declaredGap, 'no gap is declared on .editor-status-strip').not.toBe('');
    expect(
      Number.parseFloat(declaredGap),
      `editor.css declares gap: ${declaredGap} while status-strip.tsx computes with ` +
        `BAR_GAP = ${BAR_GAP}. The fit arithmetic and the cascade must agree.`,
    ).toBe(BAR_GAP);
  });
});
