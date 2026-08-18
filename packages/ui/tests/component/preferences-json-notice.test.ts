/**
 * The notice a JSON preferences document raises about itself (FR-017, FR-018a, FR-019).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-json.e2e.ts` (034 FR-045).
 *
 * Two tests there launched Electron, opened the preferences window, switched to JSON mode and typed
 * an out-of-range number into a real CodeMirror instance — in order to read a `<ul>` and check that
 * three buttons were present. What each PROBLEM says is `checkSettingsText`, already covered in
 * `packages/core/tests/unit/settings-validity.test.ts`; what this layer owns is how those problems
 * are drawn and which escapes are offered alongside them.
 *
 * `json-document-notice.tsx` was extracted first and verified against all 17 of that spec's tests,
 * unchanged, before anything here was written.
 *
 * WHAT STAYS END-TO-END: that typing invalid text into the editor PRODUCES these problems, that the
 * window actually refuses to close, and that Discard-and-close leaves the last valid document in
 * effect on disk. A component test can see that a button exists and calls back; it cannot see a
 * BrowserWindow declining to close.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  JsonDocumentNotice,
  type JsonProblem,
} from '../../src/renderer/preferences/json-document-notice.js';

/** The out-of-range case the E2E used: a document that PARSES and still cannot be applied. */
const OUT_OF_RANGE: JsonProblem = {
  kind: 'setting',
  problem: {
    key: 'panes.projects.maxWidth',
    label: 'Projects pane max width',
    reason: 'must be between 120 and 640',
    foundText: '99999',
  },
} as JsonProblem;

const UNPARSEABLE: JsonProblem = { kind: 'document', text: 'This is not valid JSON.' };

function mount(problems: readonly JsonProblem[], refusals = 0) {
  const handlers = { onCopy: vi.fn(), onDiscard: vi.fn(), onDiscardAndClose: vi.fn() };
  render(
    createElement(JsonDocumentNotice, {
      problems,
      fileName: 'settings.json',
      refusals,
      ...handlers,
    }),
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('a valid document (FR-017)', () => {
  it('shows the standing explanation and NO error notice', () => {
    // The two are alternatives in one slot. A build that showed both would push the editor down for
    // no gain, and this is the assertion that would catch it.
    mount([]);
    expect(screen.getByTestId('json-unsaved-warning')).toBeVisible();
    expect(screen.queryByTestId('json-invalid')).toBeNull();
  });

  it('names the file that will not be saved yet', () => {
    // FR-017 is the least discoverable thing about this editor, and the sentence is worthless if it
    // does not say WHICH file the user must not edit elsewhere meanwhile.
    mount([]);
    expect(screen.getByTestId('json-unsaved-warning')).toHaveTextContent('settings.json');
  });
});

describe('an invalid document (FR-019)', () => {
  it('names the offending value, what it accepts, and what was found', () => {
    // The case the old "Invalid JSON" banner could not describe at all, because the document was
    // perfectly valid JSON.
    mount([OUT_OF_RANGE]);
    const notice = screen.getByTestId('json-invalid');
    expect(notice).toHaveTextContent('panes.projects.maxWidth');
    expect(notice).toHaveTextContent('between');
    expect(notice).toHaveTextContent('99999');
    // The setting's own LABEL, quoted, so the line reads as the row does in the form.
    expect(notice).toHaveTextContent('"Projects pane max width"');
  });

  it('sets the key apart from the label rather than running them together', () => {
    mount([OUT_OF_RANGE]);
    expect(within(screen.getByTestId('json-invalid')).getByText('panes.projects.maxWidth').tagName)
      .toBe('EM');
  });

  it('replaces the standing explanation rather than joining it', () => {
    mount([OUT_OF_RANGE]);
    expect(screen.queryByTestId('json-unsaved-warning')).toBeNull();
  });

  it('lists a document-level problem with no setting behind it', () => {
    // The union's other arm: a file that will not parse has only the parser's sentence, and
    // inventing a key for it would name a setting that is not the problem.
    mount([UNPARSEABLE]);
    expect(screen.getByTestId('json-invalid')).toHaveTextContent('This is not valid JSON.');
  });

  it('lists EVERY problem, not just the first', () => {
    mount([OUT_OF_RANGE, UNPARSEABLE]);
    expect(within(screen.getByTestId('json-invalid')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('is announced, so it is not silent to a screen reader', () => {
    mount([OUT_OF_RANGE]);
    expect(screen.getByTestId('json-invalid')).toHaveAttribute('role', 'alert');
  });
});

describe('the escapes (FR-018a)', () => {
  it('offers BOTH from the moment the notice appears, before any refusal', () => {
    /*
     * The first version showed them only after the user had pressed the X and been rejected — which
     * meant the notice spent most of its life saying "you cannot leave" while the thing that made
     * that untrue was hidden. `refusals` is 0 here on purpose: nothing has been refused yet.
     */
    mount([OUT_OF_RANGE], 0);
    expect(screen.getByTestId('json-discard')).toBeVisible();
    expect(screen.getByTestId('json-discard-and-close')).toBeVisible();
    expect(screen.getByTestId('json-copy-problems')).toBeVisible();
  });

  it('routes each action to its own callback', async () => {
    const h = mount([OUT_OF_RANGE]);
    await h.user.click(screen.getByTestId('json-discard'));
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    expect(h.onDiscardAndClose).not.toHaveBeenCalled();

    await h.user.click(screen.getByTestId('json-discard-and-close'));
    expect(h.onDiscardAndClose).toHaveBeenCalledTimes(1);

    await h.user.click(screen.getByTestId('json-copy-problems'));
    expect(h.onCopy).toHaveBeenCalledTimes(1);
  });
});

describe('a refused exit', () => {
  it('flashes the one notice rather than raising a second surface (032)', () => {
    // One condition, one notice. The refusal makes the existing notice louder; it does not add a
    // toast, and it does not add a strip at the top of the window — both of which it once did.
    mount([OUT_OF_RANGE], 1);
    expect(screen.getByTestId('json-invalid').className).toContain('json-tab__error--flash');
    expect(screen.queryByTestId('json-close-blocked')).toBeNull();
  });

  it('does not flash before anything has been refused', () => {
    mount([OUT_OF_RANGE], 0);
    expect(screen.getByTestId('json-invalid').className).not.toContain('json-tab__error--flash');
  });
});
