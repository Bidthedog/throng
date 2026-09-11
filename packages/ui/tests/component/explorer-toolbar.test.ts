/**
 * The explorer toolbar — which controls it draws, in what order, what their titles say, and what a
 * click asks for (004 FR-031/032; 033 / #219 FR-018, FR-018a–c, FR-074, V1–V5, AS-16/AS-17).
 *
 * PLACE AT: `packages/ui/tests/component/explorer-toolbar.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts:209` (whole) and the tooltip half of
 * `:122` (034 FR-045).
 *
 * `ExplorerToolbar` is props-only. It takes five optional handlers, a `Keybindings` object and a
 * boolean; the only thing in it that touches a context is `Icon`, which resolves through
 * ConfigContext's REAL defaults, so no provider appears below. Passing a `Keybindings` object is the
 * whole of what the E2E spent a preferences window, a chord capture, a pill removal and a config
 * hot-reload to arrange.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - That the CHORD opens the modal, and that it opens nothing with no project (A5). That is
 *     `app.tsx`'s window-level capture listener and `NavigationChrome`'s registration, not this
 *     component.
 *   - The rebind round trip itself (`:287`): a real `keybindings.json` write, main's hot reload, and
 *     the new chord actually firing. What moves here is the narrower claim that the TITLE is computed
 *     from whatever bindings the component is holding — which is what makes the reload observable.
 *   - That an icon PACK's artwork is drawn. `Icon` has its own component test; the toolbar's claim is
 *     only that it draws through `Icon` at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '@throng/core';
import { ExplorerToolbar } from '../../src/renderer/explorer/toolbar.js';
import { registerQuickOpen } from '../../src/renderer/navigate/navigation-store.js';
import {
  registerFindInFilesOpener,
  type FindInFilesRequest,
} from '../../src/renderer/find-in-files/open-find-in-files.js';

/** The shipped chord for `navigate.quickOpen`, taken from the defaults rather than retyped. */
const DEFAULT_CHORD = DEFAULT_KEYBINDINGS.bindings['navigate.quickOpen'][0];

/** 043 FR-029a — the same, for the control this feature adds beside it. */
const FIF_CHORD = DEFAULT_KEYBINDINGS.bindings['search.findInFiles'][0];

const bound = (chords: string[]): Keybindings => ({
  version: DEFAULT_KEYBINDINGS.version,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'navigate.quickOpen': chords },
});

const boundFif = (chords: string[]): Keybindings => ({
  version: DEFAULT_KEYBINDINGS.version,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.findInFiles': chords },
});

/**
 * `registerQuickOpen` writes to a MODULE-LEVEL slot in `navigation-store.js` — one per window realm,
 * and in a test file, one per file. Leaving an opener registered would let a later test's click be
 * answered by an earlier test's spy, so it is cleared after every test rather than only where it is
 * set.
 */
afterEach(() => {
  registerQuickOpen(null);
  registerFindInFilesOpener(null);
});

function mount(props: Partial<Parameters<typeof ExplorerToolbar>[0]> = {}) {
  const handlers = {
    onExpand: vi.fn(),
    onCollapseAll: vi.fn(),
    onNewFolder: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    createElement(ExplorerToolbar, {
      ...handlers,
      keybindings: DEFAULT_KEYBINDINGS,
      quickOpenEnabled: true,
      findInFilesEnabled: true,
      ...props,
    } as Parameters<typeof ExplorerToolbar>[0]),
  );
  return { ...handlers, user: userEvent.setup() };
}

/** Every control, by accessible name, in the order it is drawn. */
const names = (): string[] =>
  Array.from(screen.getByTestId('explorer-toolbar').querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );

const quickOpen = (): HTMLElement => screen.getByRole('button', { name: 'Quick Open' });

/**
 * By its ACCESSIBLE NAME, which is the bare action — the same split Quick Open makes, and for the
 * same reason (043 R21): the title carries a LIVE chord, so a name-based locator would break on the
 * very rebind the title exists to follow.
 */
const findInFiles = (): HTMLElement => screen.getByRole('button', { name: 'Find in Files' });

describe('the shape of the toolbar (V1, V5)', () => {
  it('draws Quick Open BESIDE Collapse all, and leaves the four shipped controls alone', () => {
    /*
     * The whole list rather than just the new button, because that is what makes V5 — "it is the only
     * new toolbar control" — checkable at all. A test that only found Quick Open would stay green if
     * the feature had also dropped Delete.
     */
    mount();
    expect(names()).toEqual([
      'Expand',
      'Collapse all',
      'Quick Open',
      'Find in Files',
      'New folder',
      'Delete',
    ]);
  });

  it('draws every control as an icon, with no text label of its own (V2)', () => {
    /*
     * "No label" is asserted as "no text OUTSIDE the icon", not as "no text at all", and the
     * distinction is the migrated spec's own: at the shipped defaults no icon pack is selected, so
     * `Icon` takes its GLYPH branch and renders the theme's character as text. An empty-textContent
     * assertion would therefore fail on all five controls and would be testing that a pack was
     * installed — which is not what V2 says.
     */
    mount();

    for (const button of Array.from(
      screen.getByTestId('explorer-toolbar').querySelectorAll('button'),
    )) {
      const icons = button.querySelectorAll('.icon');
      expect(icons).toHaveLength(1);
      expect((button.textContent ?? '').trim()).toBe((icons[0].textContent ?? '').trim());
    }
  });
});

describe('the Quick Open title names the LIVE chord (FR-018a, V3, AS-16)', () => {
  it('names the action and the command’s current chord', () => {
    mount();
    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain(DEFAULT_CHORD);
  });

  it('follows a REBIND, because it is computed from the bindings it is given', () => {
    /*
     * AS-17's mechanism, one layer below the round trip. The E2E proves the rebound file reaches this
     * component; this proves that when it does, the title changes — and, critically, that the OLD
     * chord goes. A title built by appending would satisfy the first assertion and fail the second,
     * and the failure a user sees is a tooltip advertising a shortcut that no longer works.
     */
    mount({ keybindings: bound(['F8']) });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('F8');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('names the action alone when the command is UNBOUND, with no empty brackets', () => {
    // A user may remove every chord. "Quick Open ()" is the shape that ships when the empty case is
    // an afterthought rather than a branch.
    mount({ keybindings: bound([]) });

    expect(quickOpen()).toHaveAttribute('title', 'Quick Open');
  });
});

describe('with no project open the control is drawn and disabled (FR-018c, FR-074, V4)', () => {
  it('is visible and disabled rather than hidden', () => {
    mount({ quickOpenEnabled: false });

    expect(quickOpen()).toBeVisible();
    expect(quickOpen()).toBeDisabled();
  });

  it('says WHY, and recites NO chord', () => {
    /*
     * Both halves, because either alone passes for the wrong reason: a title that merely omitted the
     * chord could be empty, and a title that merely explained itself could still trail "(Ctrl+Shift+T)".
     * FR-074 narrows FR-018a to "whenever the button can act" — a disabled control should answer
     * "why can I not use this?" rather than recite a shortcut that would do nothing.
     */
    mount({ quickOpenEnabled: false });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain('no project is open');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('asks for nothing when it is clicked', async () => {
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount({ quickOpenEnabled: false });

    await user.click(quickOpen());

    expect(opener).not.toHaveBeenCalled();
  });
});

describe('clicking Quick Open goes through the ONE opener (FR-018, V3)', () => {
  it('asks the registered opener rather than opening a second modal of its own', async () => {
    /*
     * The migrated spec's "…and clicking it opens the same modal the chord opens" (`:209`). SAME is
     * the load-bearing word: the button and the chord both go through `requestQuickOpen`, so there is
     * one opener rather than two that must be kept in step. A toolbar that rendered its own picker
     * would satisfy an "a modal appeared" assertion and break FR-066's one-slot rule the moment the
     * chord was pressed as well.
     */
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount();

    await user.click(quickOpen());

    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('is harmless when no chrome is mounted to answer', async () => {
    // `requestQuickOpen` returns false when nothing is registered — a sub-workspace mid-teardown, a
    // window that has not mounted its chrome yet. The click must not throw.
    const { user } = mount();
    await expect(user.click(quickOpen())).resolves.toBeUndefined();
  });
});

/*
 * ══ 043 T065 — the Find in Files control (FR-029a, FR-029e) ══
 *
 * It copies Quick Open's raw `<button>` deliberately, including the split between `title` and
 * `aria-label` (R21), so it is asserted the same way and the two live side by side. The Find in
 * Files PANEL type is absent from the New Panel dialog (FR-017), which makes this control and the
 * folder context-menu item the feature's only discoverable routes (FR-029c) — so "drawn and
 * disabled, never hidden" is not a nicety here, it is the whole of what the user can see with no
 * project open.
 */
describe('the Find in Files control sits beside Quick Open (FR-029a, FR-029c)', () => {
  it('names the action and the command’s current chord in its title', () => {
    mount();
    const title = findInFiles().getAttribute('title') ?? '';
    expect(title).toContain('Find in Files');
    expect(title).toContain(FIF_CHORD);
  });

  it('keeps the chord OUT of the accessible name', () => {
    /*
     * The same rule Quick Open's own comment records: a locator built on the accessible name would
     * break on a rebind. Both halves are asserted, because a name that merely omitted the chord
     * could also be empty.
     */
    mount({ keybindings: boundFif(['F9']) });

    expect(findInFiles()).toHaveAttribute('aria-label', 'Find in Files');
    expect(findInFiles().getAttribute('title')).toContain('F9');
    expect(findInFiles().getAttribute('title')).not.toContain(FIF_CHORD);
  });

  it('names the action alone when the command is UNBOUND, with no empty brackets', () => {
    mount({ keybindings: boundFif([]) });
    expect(findInFiles()).toHaveAttribute('title', 'Find in Files');
  });

  it('is drawn and DISABLED with no project, saying why and reciting no chord', () => {
    mount({ findInFilesEnabled: false });

    expect(findInFiles()).toBeVisible();
    expect(findInFiles()).toBeDisabled();
    const title = findInFiles().getAttribute('title') ?? '';
    expect(title).toContain('Find in Files');
    expect(title).toContain('no project is open');
    expect(title).not.toContain(FIF_CHORD);
  });

  it('asks for nothing when a disabled control is clicked', async () => {
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount({ findInFilesEnabled: false });

    await user.click(findInFiles());

    expect(opener).not.toHaveBeenCalled();
  });

  it('goes through the ONE opener, on the TOOLBAR route (FR-031b)', async () => {
    /*
     * The route is part of the request rather than inferred, because it is what decides seeding:
     * FR-031b forbids this control from seeding the search input, and the chord requires it. A
     * request that did not name where it came from would leave that decision to whichever caller
     * remembered to make it.
     */
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount();

    await user.click(findInFiles());

    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener.mock.calls[0][0]).toMatchObject({ route: 'toolbar', replace: false });
  });

  it('asks for the WHOLE PROJECT, so a reused panel does not keep a folder scope (FR-029a)', async () => {
    /*
     * 043 round five — found while reading the entry routes, not reported.
     *
     * FR-029a says this control "starts a search over the whole project", and US3-12 says the panel
     * it opens is "scoped to the project root". The request used to carry NO scope at all, and
     * `openFindInFiles` reads an absent scope as "leave it alone" — which is right for the chord and
     * wrong here. So: right-click `src` → Find in Files, type a term, then press this control, and
     * the reused panel went on searching `src` with nothing on screen saying the toolbar had not done
     * what its requirement says.
     *
     * Asserted on the REQUEST, because that is where the defect lived: the opener behaves correctly
     * for the request it is given. `''` is the control's own spelling of the project root.
     */
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount();

    await user.click(findInFiles());

    expect(opener.mock.calls[0][0]).toMatchObject({ scopeSubPath: '' });
  });

  it('is harmless when no chrome is mounted to answer', async () => {
    const { user } = mount();
    await expect(user.click(findInFiles())).resolves.toBeUndefined();
  });
});

describe('a tree action with no handler is an action with nothing to act on', () => {
  it('disables exactly the controls whose handler is absent', () => {
    /*
     * The props are optional because the pane renders this toolbar in BOTH of its states, not because
     * a caller may forget them. Asserting one omitted and one supplied in the same render is what
     * distinguishes "disabled when omitted" from "always disabled".
     */
    mount({ onExpand: undefined, onDelete: undefined });

    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled();
  });

  it('calls the handler it was given', async () => {
    const { user, onCollapseAll } = mount();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));

    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });
});


/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T182a/T182b (FR-079, FR-079a) — the toolbar control's box is DERIVED
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The same defect as `.fif-btn`'s, on the control FR-065 is about.
 *
 * ══ THE TELL ══
 *
 *     16 + 3 + 3 = 22
 *
 * `.explorer-toolbar__btn` shipped `width: 22px; height: 22px`. The theme's icon size is
 * `sizes.iconPx: 16`, emitted as `--throng-size-icon`, and `.icon` sizes ITSELF from that token —
 * so 22 is the token's DEFAULT resolved by hand at authoring time and then frozen. Raise
 * `sizes.iconPx` in the Themes editor, which is a shipped control, and the glyph grows while its
 * box does not.
 *
 * A magic number equal to a token's default is a token dependency written in ARITHMETIC, and the
 * token's name appears nowhere in the rule — so no grep for `--throng-size-icon` will ever find it.
 * That is why nothing caught it, and it is why the guard is written as a prohibition on the LITERAL
 * rather than as a search for the token.
 *
 * ══ THIS IS PRINCIPLE X, NOT THE THEMEABLE-ICON RULE ══
 *
 * That NON-NEGOTIABLE asks three things of a control — its glyph comes from an icon token, it
 * carries a hover title naming its action, its colours come from theme tokens — and this control
 * passes all three, as the tests above assert. What is hardcoded is a METRIC. `sizes.iconPx` is a
 * shipped setting, and a control whose box ignores it is a setting that governs less than it claims,
 * which is the class the `settings-inertness` guards exist for.
 *
 * ══ ONE HONEST DIFFERENCE FROM `.fif-btn` ══
 *
 * `.fif-btn` sets `overflow: hidden`, so a raised `iconPx` CLIPS its glyph. This rule sets none and
 * `padding: 0`, so the glyph OVERFLOWS instead — it spills over the controls either side of it. Same
 * defect, same fix, and a DIFFERENT symptom: the user reports "the toolbar icons overlap", not "the
 * icon is cut in half", and a test claiming otherwise would send its reader hunting for a clip that
 * is not there.
 *
 * ══ WHY IT IS ORDERED BESIDE FR-065 THOUGH IT IS FR-079'S ══
 *
 * FR-065 exists because this control read as dwarfed beside Quick Open, and the fix is a heavier
 * glyph. The most natural next thing a user does after meeting that fix is reach for `sizes.iconPx`
 * to make the toolbar icons bigger — and this frozen box is exactly what would punish them for it.
 * Shipping "make this icon more prominent" beside the mechanism that penalises making icons more
 * prominent is the incoherence FR-062a is about.
 *
 * ══ WHY THE STYLESHEET IS READ AS TEXT ══
 *
 * jsdom does not resolve `var()` through the cascade and this suite reads these sheets as text
 * rather than attaching them to a document, so no layer below a real browser can produce a pixel
 * value here. The literal guard is the honest instrument. `find-in-files-results.test.ts` sets out
 * the same reasoning for the same assertion on `.fif-btn`, and it is not repeated at length there.
 */
describe('the toolbar control sizes itself from the icon token (FR-079, FR-079a)', () => {
  const EXPLORER_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/explorer/explorer.css');

  const sheet = (): string => {
    expect(existsSync(EXPLORER_CSS), `explorer.css was not found at ${EXPLORER_CSS}`).toBe(true);
    return readFileSync(EXPLORER_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  };

  /** One rule's declaration block, comments already stripped. */
  const ruleFor = (selector: string): string => {
    const css = sheet();
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} has no rule in explorer.css`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('declares no absolute pixel box metric', () => {
    const block = ruleFor('.explorer-toolbar__btn');
    const frozen = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']
      .map((metric) => new RegExp(`(?:^|[;{\\s])${metric}:\\s*([^;}]+)`).exec(block))
      .filter((m) => m !== null)
      .map((m) => m[1].trim())
      .filter((value) => /^\d+(?:\.\d+)?px$/.test(value));
    expect(
      frozen,
      '.explorer-toolbar__btn hardcodes a box metric in pixels — a raised sizes.iconPx then ' +
        'overflows it onto the controls beside it (FR-079)',
    ).toEqual([]);
  });

  it('derives both axes from --throng-size-icon', () => {
    const block = ruleFor('.explorer-toolbar__btn');
    for (const metric of ['width', 'height']) {
      const declared = new RegExp(`${metric}:\\s*([^;}]+)`).exec(block);
      expect(declared, `.explorer-toolbar__btn declares no ${metric}`).not.toBeNull();
      expect(
        declared[1],
        `.explorer-toolbar__btn's ${metric} must derive from --throng-size-icon, not from its resolved default`,
      ).toContain('var(--throng-size-icon');
    }
  });

  it('keeps a box the glyph can breathe in, so the fix is not "make it 16"', () => {
    // The shipped appearance is 22 at the default 16, and the padding is what the difference IS.
    // Deriving the box as exactly the token would shrink every control in the toolbar by six pixels
    // — a visible regression wearing a fix's clothes.
    const block = ruleFor('.explorer-toolbar__btn');
    expect(block).toMatch(/width:\s*calc\(/);
    expect(block).toMatch(/height:\s*calc\(/);
  });

  it('states no font size, which could never have sized the glyph anyway', () => {
    /*
     * A SEPARATE and smaller problem, recorded so the next reader does not mistake it for the
     * defect. `font-size: 14px` sat in this rule and governed nothing: `.icon` sets its own from
     * `--throng-size-icon`, and `theme.css` says why in as many words — "an icon has its OWN size …
     * Every icon was sized in `em`, so it inherited the font size of whatever surface it happened to
     * sit on" (018 follow-up). These buttons contain nothing but an `Icon`, which the V2 assertion
     * near the top of this file proves independently. It goes because it is dead and MISLEADING: it
     * is the line somebody would edit while trying to make a toolbar icon bigger, and it would do
     * nothing. `.fif-btn` carried the identical line and lost it for the identical reason.
     */
    expect(ruleFor('.explorer-toolbar__btn')).not.toMatch(/font-size\s*:/);
  });

  it('hardcodes no colour anywhere in the sheet', () => {
    // Not part of FR-079, and green before this task: it is here because this file now reads
    // explorer.css as text, and the sweep costs one assertion. Constitution XI — a themeable surface
    // names no colour literal, not even as a var() fallback.
    const literals = [
      ...sheet().matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...sheet().matchAll(/\b(?:rgb|rgba|hsl|hsla)\(/g),
    ].map((m) => m[0]);
    expect(literals, 'a themeable surface hardcodes no colour').toEqual([]);
  });
});
