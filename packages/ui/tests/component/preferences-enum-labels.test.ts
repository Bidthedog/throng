/**
 * An enum dropdown SHOWS a Title-Cased label and STORES a machine token (011 polish).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-settings.e2e.ts` (034 FR-045/FR-046):
 *   - "enum dropdowns show machine tokens in Title Case; stored value is unchanged (011 polish)"
 *
 * That test launched Electron, opened a second window through the cog menu, and then read the text
 * and the `value` attribute of five `<option>` elements. It touched no file, wrote nothing, and made
 * no claim about layout — `humanizeOptionLabel` deciding what a `<select>` renders is the whole of
 * it, and a DOM can see that in milliseconds.
 *
 * ══ WHERE IT LANDS STRONGER THAN THE E2E ══
 *
 *  - The E2E checked the line-ending abbreviations for `crlf` and `lf` only. `cr` was the third
 *    member of the same override table and the one the naive Title-Caser mangles most quietly:
 *    "Cr" is a plausible-looking word, so it would have shipped. It is asserted here.
 *  - "Stored value is unchanged" was two spot checks. It is now a sweep over EVERY static enum in
 *    `SETTINGS_METADATA`: the option values are the descriptor's `allowedValues` verbatim, in order,
 *    with nothing added or renamed. A display-side change that leaked into a stored value would have
 *    to survive every enum in the registry, not two of them.
 *  - The E2E never selected anything. Committing is asserted here: choosing "Override" calls
 *    `onCommit` with `override`, which is the actual "display-only" claim rather than a proxy for it.
 *  - The default — Last Viewed — is asserted against `buildShippedDefaults()` rather than against
 *    whatever the running app happened to have written into its config root.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 * That a selection reaches `settings.json` at all: `preferences-settings.e2e.ts` › "edits toggle /
 * select / number / array controls and applies + persists each" drives the same kind of control
 * through the real write path and stays. Nothing about the CSS of a dropdown is asserted here —
 * jsdom applies no stylesheet (034 FR-049).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `packages/ui/src/renderer/preferences/form-controls.tsx`, inside `SelectControl`, change
 * `data-testid={testId(descriptor.key)}` to `data-testid={'x-' + descriptor.key}`. Every test here
 * reaches its `<select>` through `getByTestId('control-<key>')`, which THROWS on a miss.
 * **ALL 7 tests fail** — including the population guard, whose `staticEnums` come from the registry
 * but whose sibling sweeps do not. Both of the negative assertions in this file (no camelCase label
 * survives; no option outside `allowedValues` appears) sit beside a positive one in the same test,
 * so an empty document cannot satisfy either.
 *
 * (`SelectControl` is chosen over the shared `testId` helper deliberately: the helper also names the
 * number, toggle, array and map controls, so mutating it would redden four unrelated files and prove
 * less about this one.)
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, buildShippedDefaults, getAtPath, type FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

const SHIPPED = buildShippedDefaults();

/**
 * The REAL descriptor, by key — never a hand-written copy.
 *
 * A local literal would keep passing after the registry dropped an option, which is precisely the
 * drift the E2E's use of the running form ruled out. Throwing on a missing key keeps that: a renamed
 * setting fails here rather than silently testing nothing.
 */
function descriptorFor(key: string): FieldDescriptor {
  const d = SETTINGS_METADATA.find((x) => x.key === key);
  if (!d) throw new Error(`no descriptor for ${key} — the registry has moved under this test`);
  return d;
}

function renderSelect(key: string, value: unknown = getAtPath(SHIPPED.settings, key)) {
  const onCommit = vi.fn();
  render(createElement(SettingControl, { descriptor: descriptorFor(key), value, onCommit }));
  return { onCommit, user: userEvent.setup() };
}

const select = (key: string): HTMLSelectElement =>
  screen.getByTestId(`control-${key}`) as HTMLSelectElement;

/** Every `<option>` as the pair the requirement is about: what it stores, what it shows. */
const optionPairs = (key: string): { value: string; text: string }[] =>
  [...select(key).options].map((o) => ({ value: o.value, text: o.textContent ?? '' }));

describe('the New Project starting-folder enum (011 FR-042)', () => {
  it('renders each machine token in Title Case', () => {
    renderSelect('newProject.startingFolder');
    expect(optionPairs('newProject.startingFolder')).toEqual([
      { value: 'profile', text: 'Profile' },
      { value: 'lastViewed', text: 'Last Viewed' },
      { value: 'override', text: 'Override' },
    ]);
  });

  it('defaults to Last Viewed, shown as such', () => {
    // The value is the shipped record's, so this is the DEFAULT and not a config root's leftovers.
    renderSelect('newProject.startingFolder');
    const el = select('newProject.startingFolder');
    expect(el.value).toBe('lastViewed');
    expect(el.selectedOptions[0]?.textContent).toBe('Last Viewed');
  });

  it('commits the machine token, never the label it displayed', async () => {
    // The whole of "display-only": the user picks the word "Override" and the config gets `override`.
    const { user, onCommit } = renderSelect('newProject.startingFolder');
    await user.selectOptions(select('newProject.startingFolder'), 'override');
    expect(onCommit).toHaveBeenCalledWith('override');
  });
});

describe('line-ending abbreviations keep their casing (OPTION_LABEL_OVERRIDES)', () => {
  it('renders LF, CRLF and CR — never "Lf", "Crlf" or "Cr"', () => {
    // `cr` is the one the E2E did not check and the one a naive Title-Caser mangles most quietly.
    renderSelect('editor.defaultLineEnding');
    expect(optionPairs('editor.defaultLineEnding')).toEqual([
      { value: 'lf', text: 'LF' },
      { value: 'crlf', text: 'CRLF' },
      { value: 'cr', text: 'CR' },
    ]);
  });
});

describe('the registry-wide claim (011 polish, every static enum)', () => {
  /**
   * Every descriptor whose options are DECLARED. Dynamic lists — themes on disk, detected shells,
   * language ids — are supplied by the tab at runtime and are shown verbatim by design, so they are
   * not part of this claim and have no `allowedValues` to compare against.
   */
  const staticEnums = SETTINGS_METADATA.filter(
    (d) =>
      (d.control === 'select' || d.control === 'enum') &&
      Array.isArray(d.allowedValues) &&
      d.allowedValues.length > 0,
  );

  it('has static enums to speak about at all', () => {
    // The sweep below is two `for` loops over `staticEnums`. An empty registry filter would make
    // both of them vacuous, so the population is asserted before it is used.
    expect(staticEnums.length).toBeGreaterThan(3);
  });

  it('stores the declared tokens verbatim, in order, with nothing added', () => {
    for (const d of staticEnums) {
      const allowed = (d.allowedValues as readonly unknown[]).map(String);
      // Rendered at the FIRST allowed value so the "keep an unknown current value visible" arm
      // cannot fire — this test is about the declared options, and that arm has its own reason.
      // Descriptor keys are unique, so every control in the loop keeps its own testid and the
      // trees can accumulate in one document without colliding.
      render(createElement(SettingControl, { descriptor: d, value: allowed[0], onCommit: vi.fn() }));
      expect(
        optionPairs(d.key).map((o) => o.value),
        `${d.key} renders options that are not its allowedValues`,
      ).toEqual(allowed);
    }
  });

  it('shows no raw camelCase token to the user', () => {
    for (const d of staticEnums) {
      const allowed = (d.allowedValues as readonly unknown[]).map(String);
      render(createElement(SettingControl, { descriptor: d, value: allowed[0], onCommit: vi.fn() }));
      for (const { value, text } of optionPairs(d.key)) {
        expect(text.length, `${d.key}: option ${value} rendered no label`).toBeGreaterThan(0);
        expect(
          /[a-z][A-Z]/.test(text),
          `${d.key}: option ${value} is shown to the user as the raw token "${text}"`,
        ).toBe(false);
      }
    }
  });
});
