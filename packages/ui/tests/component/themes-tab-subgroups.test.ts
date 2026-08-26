/**
 * The Themes tab renders a subgroup, and moves no shipped token to do it (040 FR-036).
 *
 * ══ THE INJECTION MECHANISM, AND THE ONE THING THAT MAKES THIS TAB DIFFERENT ══
 *
 * `ThemesTab` takes no props at all, so — like the Key Bindings tab — a synthetic descriptor can
 * only arrive by mocking the registry module. The extra hazard here is WHERE the tab reads it:
 * `THEME_TOKEN_FIELDS` is computed at MODULE SCOPE (`themes-tab.tsx`, `THEME_METADATA.filter(...)`),
 * so the mock has to replace `THEME_METADATA` — replacing `THEME_TOKEN_FIELDS` would be replacing a
 * value the tab never reads — and the substitution is fixed for the lifetime of the module.
 *
 * That is why the "unchanged" half below is phrased against the SHIPPED tokens rather than against
 * a second module load. Swapping the registry between tests would need `vi.resetModules()` and a
 * dynamic import, which re-instantiates React underneath a tree the statically-imported
 * `@testing-library/react` is still rendering. The claim that matters is not "the module was loaded
 * twice" — it is that **no shipped token moved**, and that a view containing none of the synthetic
 * descriptors renders no subsection at all. Both are asserted, and neither is weakened by the
 * synthetic rows existing elsewhere in the document.
 *
 * ══ THE GROUPER IS THE SHARED ONE, AND ONE RULE SITS OUTSIDE IT ══
 *
 * This tab groups with `groupDescriptors` — the same helper the Settings and Key Bindings tabs use
 * — reached through the tab's own `groupTokenDescriptors`, which composes rather than configures:
 * it filters, then calls the shared grouper. Two filters are stacked, and only one of them is here.
 * Icon controls are removed earlier, at module scope; what `groupTokenDescriptors` removes is
 * exactly one further key, `colours.iconColour` — a real colour token that survives the icon filter
 * and is rendered beside the icon-pack selector instead (FR-027).
 *
 * That exclusion is asserted in this file because the shared helper takes NO predicate, so the rule
 * lives at the call site rather than inside the thing it constrains — which is where a rule goes
 * missing without anything failing.
 *
 * ══ THE ID PREFIX IS `themes-subgroup-`, DELIBERATELY ══
 *
 * This tab already emits `settings-group-${group}` for its GROUPS — the Settings tab's prefix. That
 * collision is inherited, not chosen; reusing `settings-subgroup-` here would EXTEND it into ids
 * this feature is adding, which is a different thing from living with one that already exists.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Empty `held.synthetic` and the four injected-half tests fail on a missing subsection. Half (b)
 * asserts over `held.real`, which is captured inside the `vi.mock` factory, so it carries its own
 * non-empty guard — without it, an empty capture would let two tests pass having measured nothing.
 * Delete `ConfirmProvider` from `mount()` and `useConfirm` throws, so every test in the file fails
 * inside the render — which matters because two of them assert an ABSENCE.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

const GROUP = 'Synthetic';

/**
 * Everything the mock factory touches lives INSIDE `vi.hoisted`.
 *
 * `vi.mock`'s factory is hoisted above this file's imports and runs while `themes-tab.js` is being
 * resolved, so a plain module-level `const` referenced from it is still in its temporal dead zone —
 * the failure this file was first written into, and it reads as "There was an error when mocking a
 * module" rather than as a scoping mistake.
 *
 * The synthetic tokens: three in one group — one loose, then `Beta`, then `Alpha`.
 * Reverse-alphabetical declaration order on purpose. The one real subgroup this feature ships has
 * declaration order and alphabetical order agreeing, so a grouper that sorted its subsections would
 * pass every settings-tab test; FR-036a says DECLARATION order, and this is where the two differ.
 *
 * `toggle` rather than `colour`: these keys exist in no theme, so `getAtPath` answers `undefined`,
 * and a toggle renders that as an unchecked box rather than asking a colour picker to parse it.
 */
const held = vi.hoisted(() => ({
  /** What the tab reads. Real tokens plus the synthetic ones, fixed at module load. */
  registry: [] as FieldDescriptor[],
  /** The SHIPPED registry alone — the "nothing moved" half is asserted against this. */
  real: [] as FieldDescriptor[],
  synthetic: [
    {
      key: 'synthetic.loose',
      label: 'Synthetic Loose Colour',
      description: 'Carries no subgroup, so it renders above every subsection (FR-036b).',
      group: 'Synthetic',
      control: 'toggle',
    },
    {
      key: 'synthetic.beta',
      label: 'Synthetic Beta Colour',
      description: 'Declared SECOND and named later in the alphabet.',
      group: 'Synthetic',
      subgroup: 'Beta',
      control: 'toggle',
    },
    {
      key: 'synthetic.alpha',
      label: 'Synthetic Alpha Colour',
      description: 'Declared THIRD and named earlier in the alphabet.',
      group: 'Synthetic',
      subgroup: 'Alpha',
      control: 'toggle',
    },
  ] as FieldDescriptor[],
}));

vi.mock('@throng/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@throng/core')>();
  if (held.real.length === 0) held.real.push(...actual.THEME_METADATA);
  if (held.registry.length === 0) held.registry.push(...held.real, ...held.synthetic);
  return { ...actual, THEME_METADATA: held.registry };
});

function mount(): { user: ReturnType<typeof userEvent.setup> } {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfirmProvider, null, createElement(ThemesTab)),
    ),
  );
  return { user: userEvent.setup() };
}

const subsection = (subgroup: string): HTMLElement =>
  screen.getByTestId(`themes-subgroup-${GROUP}-${subgroup}`);

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (a) an INJECTED subgroup renders as a subsection
 * ────────────────────────────────────────────────────────────────────────── */

describe('an injected subgroup renders as a subsection (FR-036a)', () => {
  it('renders it inside its group section, under its own name', () => {
    mount();
    const section = screen.getByTestId(`settings-group-${GROUP}`);
    expect(section).toContainElement(subsection('Beta'));
    expect(section).toContainElement(subsection('Alpha'));
    expect(within(subsection('Beta')).getByText('Beta')).toBeInTheDocument();
  });

  it('puts each token in its own subsection, and the loose one in neither', () => {
    mount();
    expect(subsection('Beta')).toContainElement(screen.getByTestId('theme-row-synthetic.beta'));
    expect(subsection('Alpha')).toContainElement(screen.getByTestId('theme-row-synthetic.alpha'));
    const loose = screen.getByTestId('theme-row-synthetic.loose');
    expect(subsection('Beta')).not.toContainElement(loose);
    expect(subsection('Alpha')).not.toContainElement(loose);
  });

  it('renders the loose token ABOVE every subsection (FR-036b)', () => {
    mount();
    const loose = screen.getByTestId('theme-row-synthetic.loose');
    for (const name of ['Beta', 'Alpha']) {
      expect(
        loose.compareDocumentPosition(subsection(name)) & Node.DOCUMENT_POSITION_FOLLOWING,
        `the loose row must precede ${name}`,
      ).toBeTruthy();
    }
  });

  it('orders the subsections by DECLARATION, not alphabetically (FR-036a)', () => {
    mount();
    expect(
      subsection('Beta').compareDocumentPosition(subsection('Alpha')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'Beta was declared first, so Beta renders first',
    ).toBeTruthy();
  });

  it('is a labelled group to assistive technology, not an anonymous div', () => {
    // The same claim the other two tabs make. The rendering rules bind all three, and one shared
    // component is now what satisfies them — so all three assert it.
    mount();
    expect(screen.getByRole('group', { name: 'Beta' })).toBe(subsection('Beta'));
    expect(screen.getByRole('group', { name: 'Alpha' })).toBe(subsection('Alpha'));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (b) nothing shipped moved (US3 scenario 9)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the shipped theme tokens are unchanged by this feature (US3 scenario 9)', () => {
  /*
   * `held.real` is filled inside the `vi.mock` factory. Every assertion in this describe is over it
   * — the loop below, and the `colours.iconColour` exclusion — so an empty `held.real` would let
   * both pass having measured nothing at all. The capture happens in hoisted code running while
   * this file's imports are still resolving, which is precisely the ordering the header paragraph
   * warns about, so the guard is a real hazard rather than a ritual.
   */
  beforeEach(() => {
    expect(held.real.length, 'the shipped registry must have been captured').toBeGreaterThan(0);
  });

  it('leaves every shipped token in its own group section and in no subsection', () => {
    mount();
    const subsections = [...document.querySelectorAll('[data-testid^="themes-subgroup-"]')];
    for (const d of held.real) {
      // `colours.iconColour` is rendered beside the icon-pack selector, not in the Colours group —
      // see the exclusion test below.
      if (d.control === 'icon' || d.key === 'colours.iconColour') continue;
      const row = screen.getByTestId(`theme-row-${d.key}`);
      expect(screen.getByTestId(`settings-group-${d.group}`), d.key).toContainElement(row);
      for (const sub of subsections) expect(sub.contains(row), d.key).toBe(false);
    }
  });

  it('renders NO subsection once the synthetic group is filtered out', () => {
    /*
     * The nearest this file can get to "the real registry, rendered". A query that matches a
     * shipped token and none of the synthetic ones leaves the tab showing exactly what it showed
     * before this feature — and it must show no subsection at all, because the shipped registry
     * declares none.
     */
    const real = held.real.find((d) => d.control !== 'icon') as FieldDescriptor;
    mount();
    const box = screen.getByTestId('themes-search') as HTMLInputElement;
    // Real timers here: `ThemesTab` takes no `searchDebounceMs` prop, so its 150 ms debounce is
    // waited out rather than advanced — the same choice `preferences-themes-tab.test.ts` makes.
    box.focus();
    return userEvent
      .setup()
      .type(box, real.key)
      .then(async () => {
        await waitFor(() => expect(screen.queryByTestId('theme-row-synthetic.beta')).toBeNull());
        expect(screen.getByTestId(`theme-row-${real.key}`)).toBeInTheDocument();
        expect(document.querySelectorAll('[data-testid^="themes-subgroup-"]')).toHaveLength(0);
      });
  });

  it('still keeps colours.iconColour out of the generic groups (FR-027)', () => {
    /*
     * The one key the tab excludes from its generic grouping. The shared helper takes no predicate,
     * so the exclusion lives at the CALL SITE — exactly the kind of move that loses a rule silently.
     *
     * The absence assertion ALONE cannot tell "correctly excluded" from "the token was renamed, and
     * the exclusion quietly stopped applying to anything" — which is the failure this test exists
     * to catch, so the presence check comes first. `colours.iconColour` must still be IN the
     * registry for its absence from the document to mean anything.
     */
    expect(
      held.real.some((d) => d.key === 'colours.iconColour'),
      'the token must still exist for its exclusion to be observable',
    ).toBe(true);
    mount();
    expect(screen.queryByTestId('theme-row-colours.iconColour')).toBeNull();
  });
});
