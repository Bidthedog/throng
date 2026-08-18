/**
 * The one notice a JSON preferences document raises about itself.
 *
 * ══ WHY IT IS ITS OWN COMPONENT (034 FR-045) ══
 *
 * Extracted from `JsonTab`, which owns a CodeMirror instance, a file watcher, the config store and
 * IPC. So "does the notice name the offending value and what it accepts?" and "are both escapes
 * offered from the moment it appears?" were being asked by launching Electron, opening the
 * preferences window, switching to JSON mode and typing an out-of-range number into a real editor.
 * Both are questions about a list and three buttons. See
 * `packages/ui/tests/component/preferences-json-notice.test.ts`.
 *
 * Everything here is props: the host decides when a document is invalid, what is wrong with it, and
 * what discarding or closing means. In particular `onDiscardAndClose` is a callback rather than an
 * inline `window.throng?.window?.close?.()`, which is what kept the IPC in the host where it belongs
 * and let this render in jsdom.
 *
 * ══ WHY ONE COMPONENT FOR TWO MESSAGES ══
 *
 * The standing FR-017 explanation and the invalidity notice are ALTERNATIVES occupying one slot, and
 * that is a decision, not an accident: while a document is invalid the user has a more urgent thing
 * to read, and stacking both would push the editor up for no gain. Splitting them into two
 * components would have let a later change show both without anyone noticing they had — so the
 * either/or is the component's shape rather than a condition at the call site.
 *
 * The invalidity half is also 032's worked example ("One condition, one notice"): there is no toast
 * and no second strip, and it says what is WRONG rather than what the user may not do — because
 * Discard means they always may.
 */
import { type ReactElement } from 'react';
import type { SettingsProblem } from '@throng/core';

/**
 * One thing wrong with the buffer.
 *
 * A union rather than a single shape, because the two cases carry genuinely different information: a
 * bad VALUE has a setting behind it — a label, a key, a permitted set — while a document that will
 * not parse at all has only the parser's sentence. Flattening them would mean inventing a key for
 * the second, and a notice that names a setting which is not the problem is worse than one that
 * names nothing.
 *
 * Declared HERE rather than in `json-tab.tsx`, which builds these: the type describes what the
 * notice draws, and putting it in the producer would make the two modules import each other.
 */
export type JsonProblem =
  | { kind: 'setting'; problem: SettingsProblem }
  | { kind: 'document'; text: string };

export interface JsonDocumentNoticeProps {
  /** The problems found in the buffer. Empty means the document is valid. */
  problems: readonly JsonProblem[];
  /** The document's file name, named in the standing explanation. */
  fileName: string;
  /**
   * How many times an exit has been refused.
   *
   * Used as a remount key so the flash animation replays on each refusal — a second attempt to leave
   * must be answered visibly, and re-rendering the same element would not re-run the animation.
   */
  refusals: number;
  onCopy: () => void;
  onDiscard: () => void;
  onDiscardAndClose: () => void;
}

export function JsonDocumentNotice({
  problems,
  fileName,
  refusals,
  onCopy,
  onDiscard,
  onDiscardAndClose,
}: JsonDocumentNoticeProps): ReactElement {
  if (problems.length === 0) {
    /*
     * THE STANDING EXPLANATION — shown whenever there is no error to show instead.
     *
     * FR-017 is the least discoverable thing about this editor: nothing is written while you type,
     * and there is no moment where the app appears to save. A user who does not know that reads the
     * silence as "my changes are being lost", which is what happened — the behaviour was reported as
     * a bug by the person who asked for it.
     *
     * The second sentence is the one that earns its place. Because the buffer is only written on
     * leaving, a change made to the file by anything else — a text editor, another tool — is
     * overwritten when the user leaves, and that is genuinely a way to lose work.
     *
     * Amber, not red: `--throng-colour-warning` is documented as exactly this — "a warning is not a
     * failure, and colouring it red would" overstate it. Nothing here has gone wrong.
     */
    return (
      <div className="json-tab__warning" data-testid="json-unsaved-warning">
        This file will not be saved until you switch back to the UI, switch tab, or close
        preferences. Editing <strong>{fileName}</strong> directly whilst in JSON editing mode here
        may result in data loss.
      </div>
    );
  }

  return (
    <div
      key={refusals}
      className={`json-tab__error${refusals > 0 ? ' json-tab__error--flash' : ''}`}
      data-testid="json-invalid"
      role="alert"
    >
      <p className="json-tab__error-heading">This document is not valid:</p>
      <ul>
        {problems.map((p, i) =>
          p.kind === 'setting' ? (
            /*
             * The KEY so the user knows which value, the RANGE so they know what to change it to,
             * and the value they actually typed so there is no doubt which line is meant. The
             * label is quoted and the key set apart in an `<em>` so the line reads the way the row
             * does in the form rather than running the two names together.
             */
            <li key={`${p.problem.key}-${i}`}>
              &quot;{p.problem.label}&quot; (<em>{p.problem.key}</em>) {p.problem.reason}. Found{' '}
              {p.problem.foundText}.
            </li>
          ) : (
            <li key={`doc-${i}`}>{p.text}</li>
          ),
        )}
      </ul>
      <div className="json-tab__error-actions">
        <button type="button" data-testid="json-copy-problems" onClick={onCopy}>
          Copy
        </button>
        {/*
         * BOTH ESCAPES, FROM THE MOMENT THE NOTICE APPEARS (FR-018a).
         *
         * The first version showed them only after the user had pressed the X and been rejected —
         * which meant the notice spent most of its life saying "you cannot leave" while the thing
         * that made that untrue was hidden.
         */}
        <button type="button" data-testid="json-discard" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" data-testid="json-discard-and-close" onClick={onDiscardAndClose}>
          Discard and close
        </button>
      </div>
    </div>
  );
}
