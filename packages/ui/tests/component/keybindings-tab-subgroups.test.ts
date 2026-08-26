/**
 * The Key Bindings tab renders a subgroup, and renders nothing new without one (040 FR-036).
 *
 * ══ WHY THIS TAB IS TESTED AT ALL, WHEN IT DECLARES NO SUBGROUPS ══
 *
 * FR-036 binds all three tabs precisely because only one of them has a subgroup today. `subgroup`
 * is a field on the ONE `FieldDescriptor` all three read; a tab that ignored it would render the
 * next descriptor to carry one silently flat, and nothing would say so. The renderer has to be
 * correct BEFORE the first real subgroup arrives, which means the only way to assert it is to
 * inject a synthetic descriptor.
 *
 * ══ HOW THE SYNTHETIC DESCRIPTOR IS INJECTED, AND WHY IT IS SETTLED HERE ══
 *
 * The tab takes no descriptor prop — it reads `KEYBINDINGS_METADATA` from the `@throng/core`
 * barrel — so the choice is a module mock or a new test-only seam on the component. This file
 * mocks, and PARTIALLY: `importOriginal` is spread, so `COMMAND_SCOPES`, `buildShippedDefaults`,
 * `filterFields`, `scopeNames` and everything else the tab imports are the real ones. Only the
 * registry array is substituted, and it is substituted with a STABLE array whose contents each test
 * sets — which is what lets the same file assert both halves: the injected subgroup, and the real
 * registry rendering exactly as it did before this feature.
 *
 * Nothing in `packages/ui/tests/` had ever mocked `@throng/core` before. `vi.hoisted` is not
 * decoration here: `vi.mock`'s factory runs while this file's own imports are still being resolved,
 * so a plain `const` referenced from inside it is in its temporal dead zone.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Drop the synthetic descriptors from `withSubgroups()` and the four injected-half tests fail on a
 * missing subsection. Drop the mock entirely and they fail the same way, which is the state this
 * file was written in.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { KeybindingsTab } from '../../src/renderer/preferences/keybindings-tab.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';

const held = vi.hoisted(() => ({
  /** The array the tab actually reads. Stable identity; contents swapped per test. */
  registry: [] as FieldDescriptor[],
  /** The SHIPPED registry, captured from the real module so half (b) can restore it. */
  real: [] as FieldDescriptor[],
}));

vi.mock('@throng/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@throng/core')>();
  held.real = [...actual.KEYBINDINGS_METADATA];
  return { ...actual, KEYBINDINGS_METADATA: held.registry };
});

const GROUP = 'Synthetic';

/**
 * Three synthetic bindings in one group: one loose, then `Beta`, then `Alpha`.
 *
 * The subgroup names are deliberately in REVERSE alphabetical declaration order. Declaration order
 * and alphabetical order agree for the one real subgroup this feature ships, so a grouper that
 * sorted its subsections would pass every test in `settings-tab-subgroups.test.ts` — FR-036a says
 * declaration order, and this is the only place the two rules can be told apart.
 */
const SYNTHETIC: FieldDescriptor[] = [
  {
    key: 'synthetic.loose',
    label: 'Synthetic loose binding',
    description: 'Carries no subgroup, so it renders above every subsection (FR-036b).',
    group: GROUP,
    control: 'chord',
  },
  {
    key: 'synthetic.beta',
    label: 'Synthetic beta binding',
    description: 'Declared SECOND and named later in the alphabet.',
    group: GROUP,
    subgroup: 'Beta',
    control: 'chord',
  },
  {
    key: 'synthetic.alpha',
    label: 'Synthetic alpha binding',
    description: 'Declared THIRD and named earlier in the alphabet.',
    group: GROUP,
    subgroup: 'Alpha',
    control: 'chord',
  },
];

function setRegistry(items: readonly FieldDescriptor[]): void {
  held.registry.length = 0;
  held.registry.push(...items);
}

/** `searchDebounceMs: 0` is offered because the FR-036c test types into the search box; the
 *  default 150 ms debounce is real time this file has no reason to spend. */
function mountTab(props: { searchDebounceMs?: number } = {}): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ContextMenuProvider, null, createElement(KeybindingsTab, props)),
      ),
    ),
  );
}

const subsection = (subgroup: string): HTMLElement =>
  screen.getByTestId(`keybindings-subgroup-${GROUP}-${subgroup}`);

beforeEach(() => {
  setRegistry(held.real);
});

afterEach(() => {
  setRegistry(held.real);
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (a) an INJECTED subgroup renders as a subsection
 * ────────────────────────────────────────────────────────────────────────── */

describe('an injected subgroup renders as a subsection (FR-036a)', () => {
  beforeEach(() => {
    setRegistry([...held.real, ...SYNTHETIC]);
  });

  it('renders the subsection inside its group section, with the tab’s own id prefix', () => {
    mountTab();
    const section = screen.getByTestId(`keybindings-group-${GROUP}`);
    expect(section).toContainElement(subsection('Beta'));
    expect(section).toContainElement(subsection('Alpha'));
    expect(within(subsection('Beta')).getByText('Beta')).toBeInTheDocument();
  });

  it('puts each binding in its own subsection, and the loose one in neither', () => {
    mountTab();
    expect(subsection('Beta')).toContainElement(screen.getByTestId('binding-synthetic.beta'));
    expect(subsection('Alpha')).toContainElement(screen.getByTestId('binding-synthetic.alpha'));
    const loose = screen.getByTestId('binding-synthetic.loose');
    expect(subsection('Beta')).not.toContainElement(loose);
    expect(subsection('Alpha')).not.toContainElement(loose);
  });

  it('renders the loose binding ABOVE every subsection (FR-036b)', () => {
    mountTab();
    const loose = screen.getByTestId('binding-synthetic.loose');
    for (const name of ['Beta', 'Alpha']) {
      expect(
        loose.compareDocumentPosition(subsection(name)) & Node.DOCUMENT_POSITION_FOLLOWING,
        `the loose row must precede ${name}`,
      ).toBeTruthy();
    }
  });

  it('orders the subsections by DECLARATION, not alphabetically (FR-036a)', () => {
    mountTab();
    expect(
      subsection('Beta').compareDocumentPosition(subsection('Alpha')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'Beta was declared first, so Beta renders first',
    ).toBeTruthy();
  });

  it('is a labelled group to assistive technology, not an anonymous div', () => {
    // The same claim `settings-tab-subgroups.test.ts` makes, asserted here because the rendering
    // rules bind all three tabs — and because one shared component is now what satisfies it.
    mountTab();
    expect(screen.getByRole('group', { name: 'Beta' })).toBe(subsection('Beta'));
    expect(screen.getByRole('group', { name: 'Alpha' })).toBe(subsection('Alpha'));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (b) the REAL registry declares no subgroups, and nothing about it moves
 * ────────────────────────────────────────────────────────────────────────── */

describe('the shipped key bindings are unchanged by this feature (US3 scenario 9)', () => {
  /*
   * `held.real` is populated inside the `vi.mock` factory, from a module the factory resolves.
   * Every assertion below is over it — one counts elements that only exist because it is non-empty,
   * the other loops over it — so an empty `held.real` makes BOTH pass having measured nothing. That
   * is not hypothetical here: the capture happens in hoisted code whose ordering relative to this
   * file's own imports is exactly the thing the header paragraph above warns about. The guard is
   * one line and it is the difference between "the shipped registry is unchanged" and "no shipped
   * registry was consulted".
   */
  beforeEach(() => {
    expect(held.real.length, 'the shipped registry must have been captured').toBeGreaterThan(0);
  });

  it('renders no subsection at all', () => {
    // The registry declares no `subgroup`, so the tab gains the ABILITY to render one and uses it
    // nowhere. A subsection appearing here would mean a binding had quietly moved.
    mountTab();
    expect(document.querySelectorAll('[data-testid^="keybindings-subgroup-"]')).toHaveLength(0);
  });

  it('still renders every shipped binding as a row under its own group', () => {
    mountTab();
    for (const d of held.real) {
      const row = screen.getByTestId(`binding-${d.key}`);
      expect(screen.getByTestId(`keybindings-group-${d.group}`), d.key).toContainElement(row);
    }
  });

  /*
   * FR-036c on THIS tab. `contracts/metadata.md` rule 5 binds all three, and the Settings and
   * Themes files assert it; this one did not, which left the tab that renders the subsection markup
   * without a single test that the markup DISAPPEARS. The shipped registry declares no subgroup, so
   * the assertion has to be made over an injected one — the same reason every test in half (a) is
   * injected, and the reason this test seeds its own registry rather than inheriting the outer
   * `beforeEach`.
   */
  it('drops an injected subsection when a search empties it (FR-036c)', async () => {
    setRegistry([...held.real, ...SYNTHETIC]);
    mountTab({ searchDebounceMs: 0 });
    // Present FIRST, so a subsection that never rendered cannot pass this test by being absent.
    expect(screen.queryByTestId(`keybindings-subgroup-${GROUP}-Beta`)).not.toBeNull();

    /*
     * One token, and the loose binding's KEY rather than prose: the search is OR over
     * whitespace-separated tokens, so a phrase would match half the registry on its shortest word
     * and the subsection would survive for a reason unrelated to the requirement.
     */
    const box = screen.getByTestId('keybindings-search') as HTMLInputElement;
    box.focus();
    await userEvent.setup().type(box, 'synthetic.loose');

    await waitFor(() =>
      expect(
        screen.queryByTestId(`keybindings-subgroup-${GROUP}-Beta`),
        'the emptied subsection is gone',
      ).toBeNull(),
    );
    expect(screen.queryByTestId('binding-synthetic.loose'), 'its group survives').not.toBeNull();
    expect(screen.queryByText('Beta'), 'and so is its heading').toBeNull();
  });
});
