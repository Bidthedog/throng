/**
 * 043 T080/T082 — the replace PREVIEW (FR-046, FR-046a, FR-047, FR-048, FR-051).
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * Every claim here is about what a row RENDERS and about what the panel does not do. "Struck-through
 * match followed by the proposed replacement" is a DOM question, and "no file changed" is, at this
 * tier, the sharpest form of the same question the integration suite asks of the filesystem: the
 * only route the renderer has to a file is `window.throng.fileSearch.commit`, so a stub that records
 * every call proves the negative outright — the panel cannot have written anything, because it did
 * not ask.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  committedEverything,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/**
 * ══ WHY THIS FILE PINS THE TRIGGER, AND WHAT WENT WRONG WITHOUT IT ══
 *
 * Nothing here is about what starts a scan — that is `find-in-files-trigger.test.ts`. But under
 * FR-074's shipped as-you-type default, typing the term schedules a scan `settleMs` (500 ms) later,
 * and every test below drives real input through `userEvent` on real timers. So each one is a race
 * between the assertion and a timer it does not care about: reach the assertion inside 500 ms and
 * the panel is idle, take longer — which a loaded machine does — and a scan starts, the Run control
 * becomes Cancel, and `re-running the search writes nothing` fails looking for a button that is
 * momentarily not there.
 *
 * Selecting explicit run removes the timer rather than waiting on it, and weakens nothing: `Enter`
 * is an explicit run under either setting (FR-043a), so every fixture below still searches, and
 * every claim in this file is about what a row RENDERS and about what the panel does not write.
 */
const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

let stub: FileSearchStub;

const ROWS = [resultRow('src/a.ts', 1, 6), resultRow('src/b.ts', 2, 40)];

beforeEach(() => {
  config.settings = {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, trigger: 'run' },
    },
  };
  __resetFindInFilesState();
  stub = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render, run a search, and deliver two rows. */
async function withResults(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderFindInFilesPanel();
  await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
  stub.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', rows: ROWS, totalMatches: 2 });
  return user;
}

async function toggleReplaceOn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
}

describe('T080 — the preview (FR-046, FR-047)', () => {
  it('with replace OFF a row shows the match and no replacement', async () => {
    await withResults();
    expect(screen.getAllByTestId('fif-match')[0]).not.toHaveClass('fif-match--struck');
    expect(screen.queryAllByTestId('fif-replacement')).toHaveLength(0);
  });

  it('toggling replace on strikes every match through and shows the proposed text', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');

    const struck = screen.getAllByTestId('fif-match');
    expect(struck).toHaveLength(2);
    for (const el of struck) expect(el).toHaveClass('fif-match--struck');

    const proposed = screen.getAllByTestId('fif-replacement');
    expect(proposed).toHaveLength(2);
    for (const el of proposed) expect(el).toHaveTextContent('thread');
  });

  it('before-and-after is readable on ONE row: match then replacement, in that order', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');

    const row = screen.getByTestId('fif-row-src/a.ts-6');
    // `textContent` is the row as a reader sees it, in document order.
    expect(row.textContent).toContain('needlethread');
  });

  it('an EMPTY replacement renders the struck match with nothing after it (FR-046a, FR-047)', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    // The field is left blank — the shape most easily reached, and a valid deletion.
    expect(screen.getAllByTestId('fif-match')[0]).toHaveClass('fif-match--struck');
    expect(screen.queryAllByTestId('fif-replacement')).toHaveLength(0);
  });

  it('an empty replacement does not disable the commit actions (FR-046a)', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.pointer({ target: screen.getByTestId('fif-row-src/a.ts-6'), keys: '[MouseRight]' });
    // A menu row is a `li`; `aria-disabled` is what carries the state, and its ABSENCE is what
    // makes the row live.
    expect(screen.getByTestId('menu-item-Replace All')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Replace Match')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('T080 — FR-048: nothing is written until the user commits', () => {
  it('toggling replace, typing a replacement, editing the term and toggling off write nothing', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');
    await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'x');
    await user.click(screen.getByTestId(`fif-match-case-${PANEL_ID}`));
    await user.click(screen.getByTestId(`fif-whole-word-${PANEL_ID}`));
    await user.type(screen.getByTestId(`fif-scope-${PANEL_ID}`), 'src');
    await toggleReplaceOn(user); // …and off again

    // The ONE route the renderer has to a file.
    expect(stub.commit).not.toHaveBeenCalled();
  });

  it('re-running the search writes nothing', async () => {
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');
    await user.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    expect(stub.commit).not.toHaveBeenCalled();
  });
});

describe('T082 — a committed row is visibly distinguishable from a pending one (FR-051)', () => {
  it('marks the rows a commit changed, and leaves the rest pending', async () => {
    // `applied` names the edits, because that is what FR-051's marking is built from (#378).
    stub.commit.mockImplementation(async (payload: unknown) =>
      committedEverything(payload, 'changedInBuffer'),
    );
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');

    await user.pointer({ target: screen.getByTestId('fif-row-src/a.ts-6'), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Replace in File'));

    expect(screen.getByTestId('fif-row-src/a.ts-6')).toHaveAttribute('data-committed', 'true');
    // The other file was not part of this commit, so its row is still a pending preview (FR-050).
    expect(screen.getByTestId('fif-row-src/b.ts-40')).not.toHaveAttribute('data-committed');
  });

  it('a fresh run clears the committed marking — those rows describe a search that has been re-asked', async () => {
    // `applied` names the edits, because that is what FR-051's marking is built from (#378).
    stub.commit.mockImplementation(async (payload: unknown) =>
      committedEverything(payload, 'changedInBuffer'),
    );
    const user = await withResults();
    await toggleReplaceOn(user);
    await user.pointer({ target: screen.getByTestId('fif-row-src/a.ts-6'), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Replace in File'));
    expect(screen.getByTestId('fif-row-src/a.ts-6')).toHaveAttribute('data-committed', 'true');

    stub.emit({ panelId: PANEL_ID, generation: 2, status: 'complete', rows: ROWS, totalMatches: 2 });
    expect(screen.getByTestId('fif-row-src/a.ts-6')).not.toHaveAttribute('data-committed');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * T208 — FR-083 / FR-083a: what a row shows AFTER the commit
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Three states, not two. FR-083a supersedes FR-047's "every row is a preview" for exactly one of
 * them — a COMMITTED row shows the new text plainly — and leaves the other two alone: a PENDING row
 * is still the struck preview, and a SKIPPED match (FR-050) is pending, so it stays one too.
 *
 * A test that only told committed from everything else would pass while collapsing skipped into
 * committed, which is the shape this file's own fixture is built to catch: both matches are on ONE
 * line of ONE file, so a renderer that swept the file in rather than the match would look right.
 */
describe('T208 — a committed row shows the file as it now is (FR-083, FR-083a)', () => {
  /** `const needle = needle;` — two matches, one line, each carrying the other in its context. */
  const A_AFTER = 'const thread = thread;';
  const FIRST = resultRow('src/a.ts', 1, 6, {
    before: 'const ',
    matched: 'needle',
    after: ' = needle;',
  });
  const SECOND = resultRow('src/a.ts', 1, 15, {
    before: 'const needle = ',
    matched: 'needle',
    after: ';',
  });
  const ELSEWHERE = resultRow('src/b.ts', 2, 40);
  const SAME_LINE_ROWS = [FIRST, SECOND, ELSEWHERE];

  /** Render, deliver the two-on-one-line fixture, disclose replace and type `thread`. */
  async function readyForCommit(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    renderFindInFilesPanel();
    await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
    stub.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: SAME_LINE_ROWS,
      totalMatches: 3,
    });
    await user.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');
    return user;
  }

  /** The commit answers as main does: the writes that landed, and what their line now reads. */
  function answerWith(after: Record<string, string>): void {
    stub.commit.mockImplementation(async (payload: unknown) =>
      committedEverything(payload, 'changedOnDisk', after),
    );
  }

  async function pick(
    user: ReturnType<typeof userEvent.setup>,
    rowTestId: string,
    item: 'Replace All' | 'Replace in File' | 'Replace Match',
  ): Promise<void> {
    await user.pointer({ target: screen.getByTestId(rowTestId), keys: '[MouseRight]' });
    await user.click(screen.getByTestId(`menu-item-${item}`));
  }

  it('renders the new text PLAINLY — not struck, and with no proposed replacement after it', async () => {
    answerWith({ 'src/a.ts': A_AFTER });
    const user = await readyForCommit();
    await pick(user, 'fif-row-src/a.ts-6', 'Replace in File');

    const row = screen.getByTestId('fif-row-src/a.ts-6');
    expect(row).toHaveAttribute('data-committed', 'true');
    const match = row.querySelector('[data-testid="fif-match"]');
    expect(match).toHaveTextContent('thread');
    // FR-083a supersedes FR-047 for this row: the strike is what said "this has not happened yet".
    expect(match).not.toHaveClass('fif-match--struck');
    expect(row.querySelector('[data-testid="fif-replacement"]')).toBeNull();
  });

  it('gives a SAME-LINE neighbour the new line too, not the term the commit removed (FR-083b)', async () => {
    answerWith({ 'src/a.ts': A_AFTER });
    const user = await readyForCommit();
    await pick(user, 'fif-row-src/a.ts-6', 'Replace in File');

    // Both rows read the line as it now is. Swapping only `matched` leaves each one correct about
    // itself and stale about its neighbour — `thread = needle` above `needle = thread`.
    for (const testId of ['fif-row-src/a.ts-6', 'fif-row-src/a.ts-15']) {
      expect(screen.getByTestId(testId).textContent).toContain(A_AFTER);
      expect(screen.getByTestId(testId).textContent).not.toContain('needle');
    }
  });

  it('leaves a PENDING row as the FR-047 preview', async () => {
    answerWith({ 'src/a.ts': A_AFTER });
    const user = await readyForCommit();
    await pick(user, 'fif-row-src/a.ts-6', 'Replace in File');

    // `src/b.ts` was no part of this commit.
    const pending = screen.getByTestId('fif-row-src/b.ts-40');
    expect(pending).not.toHaveAttribute('data-committed');
    expect(pending.querySelector('[data-testid="fif-match"]')).toHaveClass('fif-match--struck');
    expect(pending.querySelector('[data-testid="fif-replacement"]')).toHaveTextContent('thread');
  });

  it('leaves a SKIPPED match pending — a preview, on the very line that was committed (FR-050)', async () => {
    answerWith({ 'src/a.ts': 'const thread = needle;' });
    const user = await readyForCommit();
    // ONE match of the two on that line. The other was skipped, and skipping is not committing.
    await pick(user, 'fif-row-src/a.ts-6', 'Replace Match');

    const skipped = screen.getByTestId('fif-row-src/a.ts-15');
    expect(skipped).not.toHaveAttribute('data-committed');
    expect(skipped.querySelector('[data-testid="fif-match"]')).toHaveClass('fif-match--struck');
    expect(skipped.querySelector('[data-testid="fif-replacement"]')).toHaveTextContent('thread');
  });

  it('keeps showing what was WRITTEN when the replacement box is edited afterwards', async () => {
    answerWith({ 'src/a.ts': A_AFTER });
    const user = await readyForCommit();
    await pick(user, 'fif-row-src/a.ts-6', 'Replace in File');

    // FR-050's stepping model makes this ordinary rather than exotic: commit one match, change your
    // mind about the wording, commit the next. The first row must not start claiming the new one.
    await user.clear(screen.getByTestId(`fif-replacement-${PANEL_ID}`));
    await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'spindle');

    expect(screen.getByTestId('fif-row-src/a.ts-6').textContent).toContain(A_AFTER);
    expect(screen.getByTestId('fif-row-src/a.ts-6').textContent).not.toContain('spindle');
    // …while a row still pending previews the wording as it is NOW.
    expect(screen.getByTestId('fif-row-src/b.ts-40')).toHaveTextContent('spindle');
  });

  it('falls back to the replacement it recorded when the commit sent no snippet', async () => {
    // The past-the-size-bound answer (MAX_COMMIT_SNIPPET_CHARS): the write happened and the row is
    // committed, so it must still render plainly — from the text the panel knows was written.
    stub.commit.mockImplementation(async (payload: unknown) => committedEverything(payload));
    const user = await readyForCommit();
    await pick(user, 'fif-row-src/b.ts-40', 'Replace Match');

    const row = screen.getByTestId('fif-row-src/b.ts-40');
    expect(row).toHaveAttribute('data-committed', 'true');
    expect(row.querySelector('[data-testid="fif-match"]')).toHaveTextContent('thread');
    expect(row.querySelector('[data-testid="fif-match"]')).not.toHaveClass('fif-match--struck');
    expect(row.querySelector('[data-testid="fif-replacement"]')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * T164 — FR-066: before and after must be TELLABLE APART
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The DOM tests above prove a struck match and a proposed replacement are both THERE. FR-066 is the
 * separate claim that a reader can tell which is which: the original receded relative to its
 * replacement, and the replacement carrying a highlight distinct from both the original and the row
 * behind it, in every bundled theme.
 *
 * It fails today on the second half, and the collision is exact rather than a matter of degree: on
 * the row the reader is on, `.fif-row[data-current='true'] .fif-match` and `.fif-replacement` name
 * the SAME token, so the text going away and the text arriving are painted identically.
 *
 * Asserted over the stylesheet's source for the reason `find-in-files-results.test.ts` gives at its
 * own token guard — jsdom does not substitute `var()`, so a computed-style assertion here would read
 * back the literal text or nothing at all and pass either way. What the source says exactly is the
 * thing FR-066 asks: WHICH token each surface names, and whether any two of them are the same one.
 */
describe('T164 — the preview tells before from after (FR-066)', () => {
  const CSS_PATH = resolve(
    process.cwd(),
    'packages/ui/src/renderer/find-in-files/find-in-files.css',
  );

  interface Rule {
    readonly selectors: readonly string[];
    readonly body: string;
  }

  function rules(): Rule[] {
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    const flat = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
      body: m[2],
    }));
  }

  function ruleFor(selector: string): string {
    const found = rules().filter((r) => r.selectors.includes(selector));
    expect(found.length, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(0);
    return found.map((r) => r.body).join('\n');
  }

  /** Every colour token any rule whose selector mentions `part` paints its background with. */
  function backgroundTokensUnder(part: string): string[] {
    const found = rules()
      .filter((r) => r.selectors.some((s) => s.includes(part)))
      .flatMap((r) => [...r.body.matchAll(/background:\s*var\(\s*--throng-colour-([a-zA-Z0-9-]+)/g)])
      .map((m) => m[1]);
    return [...new Set(found)];
  }

  it('recedes the struck original, with opacity rather than a colour', () => {
    // FR-066 names the instrument because the sheet forbids the obvious one: "recession is opacity
    // or a token — not a hex value and not a `var()` fallback". A dimmed colour would be a literal.
    const struck = ruleFor('.fif-match--struck');
    const opacity = /opacity:\s*([0-9.]+)/.exec(struck);
    expect(opacity, '.fif-match--struck states no recession').not.toBeNull();
    const value = Number((opacity as RegExpExecArray)[1]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    // Relative to its REPLACEMENT — so the replacement must not be receding too.
    expect(ruleFor('.fif-replacement')).not.toMatch(/opacity\s*:/);
  });

  it('gives the replacement a highlight no other surface on the row is using', () => {
    const replacement = ruleFor('.fif-replacement');
    const painted = /background:\s*var\(\s*--throng-colour-([a-zA-Z0-9-]+)/.exec(replacement);
    expect(painted, '.fif-replacement paints no highlight').not.toBeNull();
    const token = (painted as RegExpExecArray)[1];

    // "Distinct from the original": the original is a match, in either of the two states a match
    // has. "Distinct from the surrounding row": the row and the panel behind it, in all of theirs.
    const original = backgroundTokensUnder('.fif-match');
    const surrounding = [...backgroundTokensUnder('.fif-row'), ...backgroundTokensUnder('.fif-panel')];
    expect(original.length, 'no match rule paints a background — this guard would be vacuous')
      .toBeGreaterThan(0);
    expect(
      [...original, ...surrounding].filter((t) => t !== token),
      `the replacement is painted --throng-colour-${token}, which another surface on the same row ` +
        `also uses: [${[...original, ...surrounding].join(', ')}]`,
    ).toEqual([...original, ...surrounding]);
  });

  it('states a foreground for that highlight rather than inheriting one', () => {
    // A highlight strong enough to be distinct is strong enough to swallow the row's text colour,
    // and `color: inherit` is how that ships unnoticed. The pair has to be named together.
    expect(ruleFor('.fif-replacement')).toMatch(/color:\s*var\(\s*--throng-colour-/);
  });
});
