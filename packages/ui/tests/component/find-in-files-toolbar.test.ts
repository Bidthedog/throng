/**
 * 043 Cluster A — where the panel's run, commit and scope controls actually SIT (FR-068, FR-069,
 * FR-070, FR-072).
 *
 * ══ WHY POSITION IS WORTH A TEST AT ALL ══
 *
 * Four requirements in this round move controls rather than add behaviour, and a moved control is
 * the one change a behavioural test cannot see: `fif-run-*` still runs a search from inside the
 * search field, from the scope row, or from a corner of the status line. What the user is promised
 * is a LAYOUT — the run control beside the scope it will search, and Replace All beside it — so the
 * assertions here are about containment and document order, which is the weakest thing that can
 * still tell those apart.
 *
 * ══ WHAT IS DELIBERATELY NOT HERE ══
 *
 * FR-011 for the two controls this round adds (Replace All, the folder chooser) belongs to the
 * discovery guard in `find-in-files-panel-controls.test.ts` and is asserted NOWHERE else — see the
 * long note in that file. Restating a token or a title here is what made that guard unable to fail.
 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetFindInFilesState,
  markFindInFilesScopeMissing,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  committedEverything,
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

const el = (testId: string): HTMLElement => screen.getByTestId(testId);
const scopeControl = (): HTMLElement => el(`fif-scope-control-${PANEL_ID}`);

/** True when `after` is drawn later in the document than `before` — "to the right of", in a row. */
function follows(before: Element, after: Element): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Type a term and start a scan, leaving the panel in its `running` state. */
function startScan(): void {
  fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
  fireEvent.click(el(`fif-run-${PANEL_ID}`));
}

describe('the run control sits beside the scope it will search (FR-069)', () => {
  it('is outside the search field and after the scope control', () => {
    /*
     * Two halves, and both matter. "Not in the field" is the thing FR-069 names as wrong — a run
     * control inside the text field reads as part of the input rather than as the action. "After
     * the scope control" is the placement it names as right, and in a flex row that is its
     * left-to-right position.
     */
    renderFindInFilesPanel();

    const run = el(`fif-run-${PANEL_ID}`);
    expect(run.closest('.fif-controls--field')).toBeNull();
    expect(follows(scopeControl(), run)).toBe(true);
  });

  it('lets Cancel replace it in the same place while a scan runs', () => {
    /*
     * Run and Cancel are one control in two states (FR-069's second sentence), so the move has to
     * carry BOTH. Asserted as "the same parent element" rather than as pixel coordinates: jsdom
     * lays nothing out, and the parent is what a flex row actually orders.
     */
    renderFindInFilesPanel();
    const runParent = el(`fif-run-${PANEL_ID}`).parentElement;

    startScan();

    const cancel = el(`fif-cancel-${PANEL_ID}`);
    expect(screen.queryByTestId(`fif-run-${PANEL_ID}`)).toBeNull();
    expect(cancel.parentElement).toBe(runParent);
    expect(cancel.closest('.fif-controls--field')).toBeNull();
    expect(follows(scopeControl(), cancel)).toBe(true);
  });
});

describe('Replace All is offered on the toolbar, beside the run control (FR-068)', () => {
  /** Rows in two files, replace disclosed, a replacement typed — a commit is possible. */
  function readyToCommit(): void {
    renderFindInFilesPanel();
    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(el(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 6), resultRow('src/b.ts', 2, 40)],
      totalMatches: 2,
      filesScanned: 2,
    });
    fireEvent.click(el(`fif-toggle-replace-${PANEL_ID}`));
    fireEvent.change(el(`fif-replacement-${PANEL_ID}`), { target: { value: 'thread' } });
  }

  it('sits to the right of the run control', () => {
    renderFindInFilesPanel();

    const run = el(`fif-run-${PANEL_ID}`);
    const replaceAll = el(`fif-replace-all-${PANEL_ID}`);
    expect(follows(run, replaceAll)).toBe(true);
    expect(follows(scopeControl(), replaceAll)).toBe(true);
  });

  it('sends exactly what the menu item sends, through the one commit path', async () => {
    /*
     * ══ THE POINT OF THIS TEST, AND IT IS NOT THE BUTTON ══
     *
     * FR-068 is a requirement about REACH, not about a control: a second route to an irreversible
     * write must not be a second implementation of it, or FR-057b's confirmation and FR-058's
     * single notice become properties of whichever route the user happened to take. So the
     * assertion is on the PAYLOAD both routes produce — identical, down to the edit offsets —
     * which is the observable that would change the moment somebody wired the button to its own
     * `commitReplace` call with its own row selection.
     */
    bridge.commit.mockImplementation(async (payload: unknown) => committedEverything(payload));

    readyToCommit();
    fireEvent.contextMenu(el(`fif-panel-${PANEL_ID}`));
    fireEvent.click(el('menu-item-Replace All'));
    await waitFor(() => expect(bridge.commit).toHaveBeenCalledTimes(1));
    const viaMenu = bridge.commit.mock.calls[0]![0];

    cleanup();
    __resetFindInFilesState();
    bridge.commit.mockClear();

    readyToCommit();
    fireEvent.click(el(`fif-replace-all-${PANEL_ID}`));
    await waitFor(() => expect(bridge.commit).toHaveBeenCalledTimes(1));

    expect(bridge.commit.mock.calls[0]![0]).toEqual(viaMenu);
  });

  it('asks the same irreversible-commit question the menu route asks (FR-057b)', async () => {
    /*
     * The confirmation is MAIN's decision, answered on the wire as `needsConfirmation` — so the
     * only way the button could bypass it is by not going through `commitReplace` at all. Driving
     * the refusal proves the button is on that path rather than beside it.
     */
    bridge.commit.mockImplementation(async (payload: unknown) => {
      const request = payload as { confirmedIrreversible?: boolean };
      return request.confirmedIrreversible === true
        ? committedEverything(payload)
        : { committed: false, reason: 'needsConfirmation', unopenedFileCount: 2 };
    });

    readyToCommit();
    fireEvent.click(el(`fif-replace-all-${PANEL_ID}`));

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument());
    expect(bridge.commit).toHaveBeenCalledTimes(1);
  });
});

describe('the scope chooser writes a root-relative path, or refuses (FR-070)', () => {
  const scopeField = (): HTMLInputElement => el(`fif-scope-${PANEL_ID}`) as HTMLInputElement;
  const notice = (): HTMLElement | null => screen.queryByTestId(`fif-scope-notice-${PANEL_ID}`);

  /** Click the chooser with the dialog answering `chosen`, and let the promise settle. */
  async function choose(chosen: string | null): Promise<void> {
    bridge.pickFolder.mockResolvedValueOnce(chosen);
    fireEvent.click(el(`fif-scope-browse-${PANEL_ID}`));
    await waitFor(() => expect(bridge.pickFolder).toHaveBeenCalled());
  }

  it('opens the dialog at the READ scope when the box holds a full path (043 T262, FR-092b)', async () => {
    /*
     * The dialog's start folder was built from the box's RAW text, joined onto the root. A full path
     * typed in the box — which FR-092b makes legitimate — produced `D:/proj/D:/proj/src`, and where
     * the platform opens a dialog at a nonsense path is not something this app gets to decide.
     */
    renderFindInFilesPanel();
    fireEvent.change(scopeField(), { target: { value: 'D:\\proj\\src\\' } });
    await choose(null);

    expect(bridge.pickFolder).toHaveBeenCalledWith({ defaultPath: 'D:/proj/src' });
  });

  it('relativises a directory inside the project against the root', async () => {
    /*
     * The stored value is relative because FR-070 says so, and because an absolute scope would stop
     * meaning anything the moment the project moved on disk — which is the property `panel-config`
     * is built on. The dialog hands back an absolute OS path; the conversion is the point.
     */
    renderFindInFilesPanel();
    await choose('D:/proj/src/renderer');

    expect(scopeField().value).toBe('src/renderer');
    expect(notice()).toBeNull();
  });

  it('accepts the project root itself and means the whole project by it', async () => {
    /*
     * ══ THE TRAP, AND IT IS ONE LINE IN `relPathUnderRoot`'S DOC COMMENT ══
     *
     * That helper returns `null` for the ROOT, deliberately — its other callers are revealing a
     * FILE and the root row is not a thing they can mean. Here the root is the legitimate default
     * (FR-030), spelled `''`. An unguarded call therefore tells a user who browsed to their own
     * project that it is outside their project, which is why this case is asserted rather than
     * assumed.
     */
    renderFindInFilesPanel();
    fireEvent.change(scopeField(), { target: { value: 'src' } });
    await choose('D:/proj');

    expect(scopeField().value).toBe('');
    expect(notice()).toBeNull();
  });

  it('refuses a directory outside the project and writes nothing into the box', async () => {
    /*
     * "Refused rather than accepted and silently ignored" (FR-070). Both halves are asserted: the
     * refusal is visible on the control that owns the state, and the value the user had is still
     * there — a chooser that cleared the box on refusal would lose work to a mis-click.
     */
    renderFindInFilesPanel();
    fireEvent.change(scopeField(), { target: { value: 'src' } });
    await choose('D:/somewhere/else');

    expect(scopeField().value).toBe('src');
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(scopeControl().dataset.scopeNotice).toBe('outsideProject');
    expect(notice()?.textContent ?? '').not.toBe('');
  });

  it('changes nothing when the dialog is cancelled', async () => {
    renderFindInFilesPanel();
    fireEvent.change(scopeField(), { target: { value: 'src' } });
    await choose(null);

    expect(scopeField().value).toBe('src');
    expect(notice()).toBeNull();
    expect(scopeControl().dataset.scopeNotice).toBeUndefined();
  });
});

describe('the scope control carries ONE notice at a time (FR-030a, FR-070)', () => {
  /*
   * ══ ONE CONDITION, ONE NOTICE — AND HERE, ONE CONTROL WITH TWO CONDITIONS ══
   *
   * Spec 032 shipped a single invalid document as three notices in three wordings, and the lesson
   * CLAUDE.md drew from it is structural: the report belongs to whatever OWNS the state. Both of
   * these conditions are owned by the scope control, and they are ALTERNATIVES — a chosen folder
   * outside the project and a scope directory that has gone are two different things to say about
   * one field. Two markings on one control is that same shape at a smaller scale: a crowded control
   * when both hold, and no answer to which the user is meant to act on.
   *
   * So there is one slot, and the precedence is stated rather than left to fall out: THE MOST
   * RECENT CONDITION HOLDS IT. A refusal is a report about the gesture the user just made and takes
   * the slot immediately; the missing-scope condition is a standing property of the run and is
   * re-established by the next run — which is safe precisely because a refusal writes nothing and
   * leaves the scope text alone.
   */
  const scopeField = (): HTMLInputElement => el(`fif-scope-${PANEL_ID}`) as HTMLInputElement;
  const notices = (): NodeListOf<Element> =>
    scopeControl().querySelectorAll('.fif-scope__missing');
  const noticeText = (): string => el(`fif-scope-notice-${PANEL_ID}`).textContent?.trim() ?? '';

  /** Run, list a row, and have the scan report the scope gone (FR-030a's route through main). */
  function runReportingScopeMissing(generation: number): void {
    fireEvent.click(el(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation,
      status: 'scopeMissing',
      rows: [],
      totalMatches: 0,
    });
  }

  async function refuseAFolder(): Promise<void> {
    bridge.pickFolder.mockResolvedValueOnce('D:/somewhere/else');
    fireEvent.click(el(`fif-scope-browse-${PANEL_ID}`));
    await waitFor(() => expect(scopeControl().dataset.scopeNotice).toBe('outsideProject'));
  }

  it('lets a refusal take the slot from a standing missing-scope marking', async () => {
    renderFindInFilesPanel();
    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.change(scopeField(), { target: { value: 'gone' } });
    runReportingScopeMissing(1);

    expect(scopeControl().dataset.scopeNotice).toBe('missing');
    expect(notices()).toHaveLength(1);
    const missingWording = noticeText();

    await refuseAFolder();

    expect(notices()).toHaveLength(1);
    expect(noticeText()).not.toBe(missingWording);
    // And the field the refusal did not write to still holds what the user had.
    expect(scopeField().value).toBe('gone');
  });

  it('lets the next run re-establish the missing-scope marking over a refusal', async () => {
    renderFindInFilesPanel();
    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.change(scopeField(), { target: { value: 'gone' } });
    await refuseAFolder();
    expect(notices()).toHaveLength(1);

    runReportingScopeMissing(1);

    expect(scopeControl().dataset.scopeNotice).toBe('missing');
    expect(notices()).toHaveLength(1);
  });

  it('keeps FR-030a informational: every listed row survives the marking', () => {
    /*
     * Generalising the flag is exactly the kind of change that turns a marking into an error state
     * for the whole panel, so the property FR-030a is emphatic about is re-asserted on the new
     * shape rather than trusted to have survived it.
     *
     * Raised OUT OF BAND — the shape the watcher consumer uses (043 T078) — and that distinction is
     * the requirement, not a testing convenience. A RUN refused for a missing scope supersedes into
     * a fresh generation with every counter zeroed, because FR-030a also demands that such a run
     * find nothing and be distinguishable from one that found nothing in a scope that exists. The
     * "results stay listed" half is about the directory going while a finished run is on screen.
     */
    renderFindInFilesPanel();
    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(el(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });
    act(() => {
      markFindInFilesScopeMissing(PANEL_ID);
    });

    expect(scopeControl().dataset.scopeNotice).toBe('missing');
    expect(scopeField().getAttribute('aria-invalid')).toBe('true');
    expect(scopeField().disabled).toBe(false);
    const rows = screen.getAllByTestId(/^fif-row-/);
    expect(rows).toHaveLength(1);
    for (const row of rows) expect(row.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('states the condition through one attribute, not two', async () => {
    // The old `data-missing` is GONE rather than kept alongside: two attributes for two alternative
    // conditions is the crowded control this consolidation exists to remove. Asserted in BOTH
    // conditions, because an attribute kept for one of them is exactly the half-migration that
    // reads as done from the other.
    renderFindInFilesPanel();
    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    runReportingScopeMissing(1);

    expect(scopeControl().dataset.missing).toBeUndefined();
    expect(scopeControl().dataset.scopeNotice).toBe('missing');

    await refuseAFolder();

    expect(scopeControl().dataset.missing).toBeUndefined();
    expect(scopeControl().dataset.scopeNotice).toBe('outsideProject');
  });
});

describe('the panel no longer says which scope its results came from (FR-072)', () => {
  it('shows no readout before a run, after a run, or after the control is retargeted', () => {
    /*
     * FR-072 supersedes FR-030's "MUST show which scope its results came from" outright, so there
     * is no state left in which the readout is correct — which is why this is asserted across the
     * three states that used to produce one rather than on a fresh panel alone.
     */
    renderFindInFilesPanel();
    const ran = (): HTMLElement | null => screen.queryByTestId(`fif-scope-ran-${PANEL_ID}`);
    expect(ran()).toBeNull();

    fireEvent.change(el(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.change(el(`fif-scope-${PANEL_ID}`), { target: { value: 'src' } });
    fireEvent.click(el(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });
    expect(ran()).toBeNull();

    // The state the readout existed FOR — a control naming one directory over results from another.
    fireEvent.change(el(`fif-scope-${PANEL_ID}`), { target: { value: 'lib/deep' } });
    expect(ran()).toBeNull();
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
    // And the panel still says nothing of the sort in words, whatever id it might hang it on.
    expect(el(`fif-panel-${PANEL_ID}`).textContent ?? '').not.toMatch(/results from/i);
  });
});
