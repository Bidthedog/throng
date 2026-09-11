/**
 * 043 T112b / FR-011 — every action control the Find in Files PANEL introduces is a themeable icon
 * carrying a hover title that names its action, with its colours resolved from theme tokens.
 *
 * ══ WHAT ALREADY COVERS PART OF THIS, AND IS NOT REPEATED ══
 *
 *   - the explorer toolbar's Find in Files control — `tests/component/explorer-toolbar.test.ts`
 *     (T065), which sweeps every button in that toolbar for one `.icon` and no word label, and
 *     asserts the live chord in its title;
 *   - the find bar's replace DISCLOSURE — `tests/component/find-bar-disclosure.test.ts` (FR-008);
 *   - that every `<Icon token="…">` literal in the renderer names a token the shipped theme
 *     defines — `tests/unit/icon-tokens-exist.test.ts`, which is why no assertion below re-states
 *     a token NAME;
 *   - that `find-in-files.css` hardcodes no colour and reads no token the theme has never heard of
 *     — `tests/component/find-in-files-results.test.ts` (FR-044), asserted over the whole sheet.
 *     The last group here is the POSITIVE half that sweep cannot make: that the control rule
 *     actually resolves its colours from tokens rather than inheriting whatever it lands on.
 *   - the group toggle's title in ONE direction — `find-in-files-results.test.ts` reads
 *     `/collapse/i` off an expanded group. Both directions matter, because the title names what the
 *     click WILL do and a toggle that keeps one wording is wrong in half its states.
 *
 * ══ WHY THE SCOPE CONTROL IS ASSERTED DIFFERENTLY ══
 *
 * FR-011 governs ACTION CONTROLS, and the scope control is a text field: it is not an icon and
 * cannot carry a hover title naming an action, because typing in it performs none. What the
 * requirement binds on it is the icon beside it — themeable, resolved from `searchScope` — and its
 * ACTION lives in the panel's menu as *Change scope*, which is asserted with the other menu rows
 * below. The field itself is named to a screen reader instead, which is the accessible-name rule
 * the input controls elsewhere in the app follow.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  cleanup();
  removeFileSearchStub();
  __resetFindInFilesState();
});

/**
 * The whole of FR-011 for one control, in one place.
 *
 * "No text label" is asserted as "no text OUTSIDE the icon" rather than as "no text at all", for
 * the reason `explorer-toolbar.test.ts` records: at the shipped defaults no icon pack is selected,
 * so `Icon` takes its GLYPH branch and renders the theme's character as text. An empty-textContent
 * assertion would fail on all of them and would be testing that a pack was installed.
 */
function expectThemeableIconControl(control: HTMLElement, titleNames: RegExp): void {
  const icons = control.querySelectorAll('.icon');
  expect(icons, `${control.dataset.testid ?? control.tagName} draws exactly one icon`).toHaveLength(
    1,
  );
  expect((control.textContent ?? '').trim()).toBe((icons[0]!.textContent ?? '').trim());

  const title = control.getAttribute('title') ?? '';
  expect(title, `${control.dataset.testid ?? '?'} has no hover title`).not.toBe('');
  expect(title, `"${title}" does not name the action`).toMatch(titleNames);
}

const control = (testId: string): HTMLElement => screen.getByTestId(testId);

/** Two files in two folders — enough for a group heading, and therefore a collapse control. */
function emitResults(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('lib/b.ts', 2, 20)],
    totalMatches: 2,
    filesScanned: 2,
  });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The toolbar's action controls
 * ────────────────────────────────────────────────────────────────────────── */

describe('every action control in the panel toolbar is a titled, themeable icon (FR-011)', () => {
  it('draws the replace toggle as an icon whose title names what the click will do', () => {
    /*
     * The panel's own disclosure, and the control FR-029d points at: replace in files adds no
     * toolbar control of its own, so this toggle is how it is discovered. The title has to change
     * with the state for the same reason the group toggle's does — "Show replace" on a row that
     * would hide it is a tooltip telling the user the opposite of what will happen.
     */
    renderFindInFilesPanel();

    const toggle = control(`fif-toggle-replace-${PANEL_ID}`);
    expectThemeableIconControl(toggle, /show replace/i);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expectThemeableIconControl(control(`fif-toggle-replace-${PANEL_ID}`), /hide replace/i);
    expect(control(`fif-toggle-replace-${PANEL_ID}`).getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the two grouping controls as icons naming the grouping each selects', () => {
    // FR-033a's two, and they are a set: a title that named the CONCEPT ("Grouping") rather than
    // the choice would leave identical tooltips on different buttons.
    renderFindInFilesPanel();

    expectThemeableIconControl(control(`fif-grouping-file-${PANEL_ID}`), /group by file/i);
    expectThemeableIconControl(
      control(`fif-grouping-fileAndFolder-${PANEL_ID}`),
      /group by folder and file/i,
    );
    // FR-073 — the withdrawn grouping has no control at all. Not a disabled one: it is not a thing
    // the panel can do, and a disabled control claims it is temporarily unavailable.
    expect(screen.queryByTestId(`fif-grouping-folder-${PANEL_ID}`)).toBeNull();
  });

  it('draws the match modes and the run control the same way', () => {
    // FR-011 binds every action control the feature introduces, not only the ones T112b enumerates.
    // These are the rest of the toolbar, and they are cheap to hold to the same rule.
    renderFindInFilesPanel();

    expectThemeableIconControl(control(`fif-match-case-${PANEL_ID}`), /match case/i);
    expectThemeableIconControl(control(`fif-whole-word-${PANEL_ID}`), /whole word/i);
    expectThemeableIconControl(control(`fif-run-${PANEL_ID}`), /run search/i);
  });

  it('draws Cancel the same way once a scan is running', () => {
    // Run and Cancel are ONE control in two states, so the second state has to be reached to be
    // asserted at all — and it is the state a user meets while waiting, which is when they hover.
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(control(`fif-run-${PANEL_ID}`));

    expectThemeableIconControl(control(`fif-cancel-${PANEL_ID}`), /cancel search/i);
  });

  it('leaves no button in the toolbar without an icon or a title', () => {
    /*
     * The sweep, and the only part of this file that can catch the NEXT control somebody adds. The
     * named assertions above say what each control means; this one says that the set is closed.
     */
    renderFindInFilesPanel();
    emitResults();

    const buttons = Array.from(
      screen.getByTestId(`fif-panel-${PANEL_ID}`).querySelectorAll('button'),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelectorAll('.icon'), `${button.dataset.testid ?? '?'}`).toHaveLength(1);
      expect(button.getAttribute('title') ?? '', `${button.dataset.testid ?? '?'}`).not.toBe('');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The same requirement, DISCOVERED rather than listed (043 T153a)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHY THIS EXISTS BESIDE THE ENUMERATION ABOVE ══
 *
 * Everything above names the control it asserts, which is what makes it readable and what makes it
 * structurally incapable of covering anything added later. A control introduced by the next round
 * is not in any of those lists, so it is covered by nothing — which is exactly what happened to
 * this round's Replace All and folder chooser, both of which reached a rendered panel with no
 * hover title while every named assertion above stayed green.
 *
 * So the predicate here is over the RENDERED TREE and names nothing: every `<button>` in the
 * panel's subtree that draws an element carrying the `icon` class. A renamed control stays covered;
 * a new one is covered the moment it is added.
 *
 * ══ THE CARVE-OUTS, AS PROPERTIES WHERE THEY CAN BE ══
 *
 * The scope control needs no carve-out at all: it is an `<input>`, and the predicate is over
 * buttons. Its icon and its accessible name keep their own named assertions further down.
 *
 * ONE carve-out cannot be made a property, and is admitted rather than hidden: the three commit
 * granularities and collapse/expand-all are MENU-ONLY, so they are never in the panel's rendered
 * subtree and no query over it can reach them. They stay asserted where they are actually drawn —
 * as icon cells and labels in the menu, below. This predicate is therefore deliberately not the
 * whole of FR-011 for this panel, and saying so is honest; pretending one query covered both
 * surfaces would not be.
 */
describe('FR-011 holds for every icon button the panel draws, named or not (T153a)', () => {
  /** Every glyph the active theme can legitimately produce, for the "the token resolved" half. */
  const THEME_GLYPHS = new Set(Object.values(THRONG_THEME.icons));

  function sweepPanel(): void {
    const panel = screen.getByTestId(`fif-panel-${PANEL_ID}`);
    const buttons = Array.from(panel.querySelectorAll('button')).filter(
      (button) => button.querySelector('.icon') !== null,
    );
    expect(buttons.length, 'the panel drew no icon buttons at all').toBeGreaterThan(0);

    for (const button of buttons) {
      const where = button.dataset.testid ?? button.className;
      const icon = button.querySelector('.icon')!;

      /*
       * The token RESOLVED. A token the theme has never heard of renders nothing at all — an
       * invisible control with no error anywhere, which is how an unresolved icon reaches a
       * release (029's Clear control, #127's clipboard rows). Either the theme's own glyph, or an
       * inlined pack SVG, and nothing else counts.
       */
      const glyph = (icon.textContent ?? '').trim();
      const svg = icon.querySelector('svg');
      if (svg === null) {
        expect(glyph, `${where} draws a blank icon`).not.toBe('');
        expect(THEME_GLYPHS.has(glyph), `${where} draws a glyph no theme token defines`).toBe(true);
      }

      // The hover title, which is the control's whole accessible name: the icon is `aria-hidden`.
      expect((button.getAttribute('title') ?? '').trim(), `${where} has no hover title`).not.toBe(
        '',
      );

      /*
       * And no colour decided at the call site. `find-in-files-results.test.ts` sweeps the
       * STYLESHEET for literals; this is the other half — a colour inlined onto the element
       * bypasses the sheet entirely and so bypasses that sweep with it.
       */
      const inline = `${button.getAttribute('style') ?? ''} ${icon.getAttribute('style') ?? ''}`;
      expect(inline, `${where} inlines a colour`).not.toMatch(/colou?r|background|#[0-9a-f]{3}|rgb|hsl/i);
    }
  }

  it('holds on a panel that has not run yet', () => {
    renderFindInFilesPanel();
    sweepPanel();
  });

  it('holds once results are listed and replace is disclosed', () => {
    // Two more states, because controls appear in them: the group collapse toggles arrive with the
    // rows, and the replacement row arrives with the disclosure.
    renderFindInFilesPanel();
    emitResults();
    fireEvent.click(control(`fif-toggle-replace-${PANEL_ID}`));
    sweepPanel();
  });

  it('holds while a scan is running, where Cancel stands in for Run', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(control(`fif-run-${PANEL_ID}`));
    sweepPanel();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Collapse and expand
 * ────────────────────────────────────────────────────────────────────────── */

describe('the collapse/expand control names its direction (FR-011, FR-034)', () => {
  it('says Collapse while the group is open and Expand once it is closed', () => {
    renderFindInFilesPanel();
    emitResults();

    const toggle = (): HTMLElement => control('fif-group-toggle-src/a.ts');
    expectThemeableIconControl(toggle(), /collapse group/i);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle());
    expectThemeableIconControl(toggle(), /expand group/i);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('changes the icon with the direction, not only the words', () => {
    /*
     * A chevron that never turns is the failure a title-only assertion cannot see, and it is the
     * one a user actually reads: they scan the column of arrows, not the tooltips. Asserted as
     * "the glyph differs" rather than by naming `chevronRight`/`chevronDown`, because the token
     * names are `icon-tokens-exist.test.ts`'s and the pack may legitimately replace both.
     */
    renderFindInFilesPanel();
    emitResults();

    const glyph = (): string =>
      control('fif-group-toggle-src/a.ts').querySelector('.icon')?.textContent?.trim() ?? '';
    const expanded = glyph();
    fireEvent.click(control('fif-group-toggle-src/a.ts'));

    expect(expanded).not.toBe('');
    expect(glyph()).not.toBe(expanded);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The scope control — a field with a themeable icon, and an action in the menu
 * ────────────────────────────────────────────────────────────────────────── */

describe('the scope control draws a themeable icon and names itself (FR-011, FR-030)', () => {
  it('puts one icon beside the field and no word in its place', () => {
    renderFindInFilesPanel();

    /*
     * `.fif-field__icon`, not "every icon in the control".
     *
     * FR-070 put a second icon on this row — the folder chooser — and it is an ACTION control, so
     * it belongs to the button sweep above rather than here. Narrowing the selector keeps this
     * assertion about the thing it was written for: the decorative icon that labels the field,
     * which is what FR-011 binds on a control the user types into.
     */
    const scope = control(`fif-scope-control-${PANEL_ID}`);
    const icons = scope.querySelectorAll('.fif-field__icon .icon');
    expect(icons).toHaveLength(1);
    // Rendered, not blank: a token the theme does not define renders NOTHING, silently, which is
    // exactly how an unresolved icon reaches a release (029's Clear control, #127's clipboard rows).
    expect((icons[0]!.textContent ?? '').trim()).not.toBe('');
    expect(icons[0]!.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the field to a screen reader, since a text input carries no hover title', () => {
    renderFindInFilesPanel();

    const field = control(`fif-scope-${PANEL_ID}`);
    expect(field.tagName).toBe('INPUT');
    expect(field.getAttribute('aria-label')).toBe('Search scope');
    // And it says what searching with it empty would mean, rather than leaving the user to guess
    // that a blank scope is the whole project (FR-030).
    expect(field.getAttribute('placeholder')).toBe('Whole project');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The menu rows — the commit granularities, and the panel-level collapse/expand
 * ────────────────────────────────────────────────────────────────────────── */

describe('every panel action offered only in the menu carries a drawn icon (FR-011, FR-025a)', () => {
  const openPanelMenu = (): void => {
    fireEvent.contextMenu(screen.getByTestId(`fif-panel-${PANEL_ID}`));
  };

  const row = (label: string): HTMLElement => screen.getByTestId(`menu-item-${label}`);

  /**
   * The three commit granularities (FR-049) plus the actions that have no toolbar control at all.
   *
   * These are the controls FR-011 reaches that no `.fif-btn` assertion can: a granularity is
   * offered only here, so its icon cell is the only place its token is ever resolved — and
   * `tests/unit/menu-icon-tokens.test.ts` does not read this builder, which makes an unresolved
   * token here invisible to every other test in the repository.
   */
  const MENU_ONLY_ACTIONS = [
    'Replace All',
    'Replace in File',
    'Replace Match',
    'Collapse all',
    'Expand all',
    'Change scope',
  ];

  it('draws a non-empty icon in every one of their cells', () => {
    renderFindInFilesPanel();
    emitResults();
    openPanelMenu();

    for (const label of MENU_ONLY_ACTIONS) {
      const cell = row(label).querySelector('.context-menu__icon');
      expect(cell, `${label} has no icon cell`).not.toBeNull();
      expect((cell?.textContent ?? '').trim(), `${label} draws a blank icon`).not.toBe('');
    }
  });

  it('labels each of them with the action it performs', () => {
    // The menu's equivalent of a hover title: the row says what it does, in the words the
    // requirement uses. A granularity labelled "Replace" three times would be three identical rows.
    renderFindInFilesPanel();
    emitResults();
    openPanelMenu();

    for (const label of MENU_ONLY_ACTIONS) {
      expect(row(label).querySelector('.context-menu__label')?.textContent ?? '').toBe(label);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The colours — resolved from tokens, which is the half a rendered DOM cannot show
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolved from the working directory, not from `import.meta.url`.
 *
 * This layer runs in jsdom, where `import.meta.url` is an `http:` URL and `fileURLToPath` throws
 * before a single test is collected. `find-in-files-results.test.ts` reads the same sheet the same
 * way for the same reason.
 */
const CSS_PATH = resolve(process.cwd(), 'packages/ui/src/renderer/find-in-files/find-in-files.css');

describe('the control resolves its colours from theme tokens (FR-011)', () => {
  it('reads foreground, background and border from tokens in every state it draws', () => {
    /*
     * `find-in-files-results.test.ts` already asserts the negative over the whole sheet — no
     * hardcoded colour, and no token the shipped theme has never heard of. That sweep passes
     * perfectly on a control that states no colour at all, which is the failure this asserts
     * against: an icon control that inherits whatever it lands on is not themeable, it is
     * accidental, and it is invisible until somebody switches to a light theme.
     */
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    const sheet = readFileSync(CSS_PATH, 'utf8');
    const ruleFor = (selector: string): string => {
      const at = sheet.indexOf(`${selector} {`);
      expect(at, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(-1);
      return sheet.slice(at, sheet.indexOf('}', at));
    };

    // The resting state: a control that names no colour of its own is the defect above.
    expect(ruleFor('.fif-btn')).toContain('color: var(--throng-colour-');
    // The engaged state — a match mode or the grouping in force — reads as SELECTED, and that is a
    // colour decision the theme has to own too.
    const engaged = ruleFor('.fif-btn--on');
    expect(engaged).toContain('color: var(--throng-colour-');
    expect(engaged).toContain('background: var(--throng-colour-');
    expect(engaged).toContain('border-color: var(--throng-colour-');
  });
});
