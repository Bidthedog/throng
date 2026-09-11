/**
 * 043 T064e — the scope control (FR-030, FR-030a).
 *
 * ══ ONE THING NOW, NOT TWO (FR-072, 043 T156) ══
 *
 * FR-030 used to ask for two readings at once: a panel that shows *which scope its results came
 * from*, AND an editable control that retargets *without starting again*. One field cannot be both,
 * so the panel carried a second readout beside the control — and the test that mattered was the one
 * where the two disagreed.
 *
 * FR-072 withdraws the first clause by name, so that test is GONE rather than narrowed: it pinned a
 * requirement that no longer exists, and adjusting it would have left an assertion in the suite with
 * nothing behind it. What survives of it is asserted below on its own terms — retargeting still
 * starts nothing, and the rows already listed still stand.
 *
 * ══ A MISSING SCOPE IS A MARK, NOT A MUTE ══
 *
 * FR-030a is explicit that the marking is informational: results already listed stay listed and
 * fully usable, with no row disabled, hidden or reordered. That is asserted directly, because the
 * intuitive implementation — treat a missing scope as an error state for the whole panel — passes
 * "the scope is marked" and fails the requirement.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import {
  __resetFindInFilesState,
  markFindInFilesScopeMissing,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

function mount(): void {
  renderFindInFilesPanel();
}

const scopeField = (): HTMLInputElement =>
  screen.getByTestId(`fif-scope-${PANEL_ID}`) as HTMLInputElement;
const scopeControl = (): HTMLElement => screen.getByTestId(`fif-scope-control-${PANEL_ID}`);

function runWith(scope: string, term = 'needle'): void {
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: term } });
  fireEvent.change(scopeField(), { target: { value: scope } });
  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
  bridge.emit({
    panelId: PANEL_ID,
    generation: bridge.start.mock.calls.length,
    status: 'complete',
    rows: [resultRow(`${scope || 'src'}/a.ts`, 1, 0)],
    totalMatches: 1,
  });
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the scope control says where the search looks (FR-030)', () => {
  it('is an editable control carrying the scope icon token', () => {
    mount();
    // The `searchScope` token was added in T029 and this is its call site — an icon token with
    // none renders nowhere and is indistinguishable from a token that was never added.
    expect(scopeControl()).toHaveTextContent(THRONG_THEME.icons.searchScope);
    expect(scopeControl().querySelector('svg')).toBeNull();
    expect(scopeField().disabled).toBe(false);
    // Empty means the whole root (FR-030's default), and the field says so rather than looking blank.
    expect(scopeField().value).toBe('');
    expect(scopeField().getAttribute('placeholder') ?? '').not.toBe('');
  });

  it('retargets without starting a search, leaving the listed results standing', () => {
    /*
     * What is left of FR-030 once FR-072 has taken the readout: the control moves, and nothing
     * else does. The half that has GONE — a statement of which scope the listed rows came from —
     * is asserted absent in `find-in-files-toolbar.test.ts`, so its removal is pinned somewhere
     * rather than merely untested.
     */
    mount();
    runWith('src');

    fireEvent.change(scopeField(), { target: { value: 'lib/deep' } });

    expect(scopeField().value).toBe('lib/deep');
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
  });

  it('sends the sub-path with the scan, and nothing when the whole root is searched', () => {
    mount();
    runWith('src');
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ scopeSubPath: 'src' });

    fireEvent.change(scopeField(), { target: { value: '' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));

    expect(bridge.start.mock.calls[1][0]).toMatchObject({ scopeSubPath: null });
  });
});

describe('a missing scope is marked on the control and mutes nothing (FR-030a)', () => {
  it('marks the control while every listed row stays usable', () => {
    mount();
    runWith('src');
    const before = screen.getAllByTestId(/^fif-row-/).map((el) => el.dataset.relPath);

    // Wrapped, because this is the shape the watcher consumer will call it in (043 T078): a store
    // write from outside React, with no event behind it for the harness to flush on.
    act(() => {
      markFindInFilesScopeMissing(PANEL_ID);
    });

    expect(scopeControl().dataset.scopeNotice).toBe('missing');
    expect(scopeField().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId(`fif-scope-notice-${PANEL_ID}`)).toBeInTheDocument();

    // Nothing hidden, nothing reordered, nothing disabled — the marking is informational.
    const after = screen.getAllByTestId(/^fif-row-/);
    expect(after.map((el) => el.dataset.relPath)).toEqual(before);
    for (const row of after) {
      expect(row.getAttribute('aria-disabled')).not.toBe('true');
      expect(row.dataset.disabled).toBeUndefined();
    }
  });

  it('clears the marking when the user retargets the scope', () => {
    mount();
    runWith('src');
    // Wrapped, because this is the shape the watcher consumer will call it in (043 T078): a store
    // write from outside React, with no event behind it for the harness to flush on.
    act(() => {
      markFindInFilesScopeMissing(PANEL_ID);
    });
    expect(scopeControl().dataset.scopeNotice).toBe('missing');

    fireEvent.change(scopeField(), { target: { value: 'lib' } });

    expect(scopeControl().dataset.scopeNotice).toBeUndefined();
    expect(screen.queryByTestId(`fif-scope-notice-${PANEL_ID}`)).toBeNull();
    // Retargeting clears the CONDITION, not the results, and still starts nothing.
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  it('marks the control when a run reports the scope gone (FR-030a via the scan)', () => {
    mount();
    runWith('src');
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'scopeMissing',
      rows: [],
      totalMatches: 0,
    });

    expect(scopeControl().dataset.scopeNotice).toBe('missing');
    expect(screen.getByTestId(`fif-status-${PANEL_ID}`).dataset.state).toBe('scopeMissing');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T249 (FR-092b) — what the box accepts, typed
 *
 * The box used to be sent verbatim. Each case below is a thing a person can type that went wrong:
 * an absolute path read as missing, an outside path read as missing rather than refused, and a
 * trailing slash or a backslash carried into every row's path. The reading itself is pinned in
 * core (`scope-input.test.ts`); what is asserted HERE is that the panel reads the box through it
 * before a scan starts, and that the box keeps what the user typed.
 * ────────────────────────────────────────────────────────────────────────── */

describe('what the box accepts, typed (FR-092b)', () => {
  function typeAndRun(scope: string): void {
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.change(scopeField(), { target: { value: scope } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
  }

  it('searches a full path inside the project as its root-relative scope — a file, per FR-092', () => {
    mount();
    typeAndRun('D:/proj/src/renderer/app.tsx');

    expect(bridge.start.mock.calls[0][0]).toMatchObject({ scopeSubPath: 'src/renderer/app.tsx' });
    // The reading happens where the scope is USED. The box is the user's, and rewriting it under
    // them — under as-you-type, mid-word — would be a control fighting its own typist.
    expect(scopeField().value).toBe('D:/proj/src/renderer/app.tsx');
  });

  it('refuses a full path OUTSIDE the project on the control, and starts nothing (FR-070)', () => {
    mount();
    typeAndRun('C:/elsewhere/src');

    expect(bridge.start).not.toHaveBeenCalled();
    // FR-070's refusal, not FR-030a's missing marking: before this, a typed outside path was sent to
    // main, joined onto the root, and reported as a scope that had gone — the wrong condition.
    expect(scopeControl().dataset.scopeNotice).toBe('outsideProject');
  });

  it('refuses a relative path that climbs out, rather than clamping it to the root', () => {
    mount();
    typeAndRun('../other');

    expect(bridge.start).not.toHaveBeenCalled();
    expect(scopeControl().dataset.scopeNotice).toBe('outsideProject');
  });

  it('sends a trailing slash and backslashes as the scope they mean', () => {
    mount();
    typeAndRun('src\\renderer\\');

    // Sent verbatim, this became the row prefix `src\renderer\/` — every row's path carried it.
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ scopeSubPath: 'src/renderer' });
  });

  it('sends the project root, typed out in full, as the whole project', () => {
    mount();
    typeAndRun('D:\\proj\\');

    expect(bridge.start.mock.calls[0][0]).toMatchObject({ scopeSubPath: null });
  });
});
