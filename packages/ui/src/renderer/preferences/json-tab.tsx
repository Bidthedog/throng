import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  checkSettingsText,
  formatSettingsProblem,
  type ConfigDocId,
  type SettingsProblem,
} from '@throng/core';
import { registerPendingCommit, writeConfig } from '../config/write-config.js';
import { StandaloneEditor } from '../editor/standalone-editor.js';
import { useCopyToClipboard } from '../common/use-copy.js';
import { useJsonEditGate } from './json-edit-gate.js';

/**
 * A JSON editor tab (feature 007, US5 — FR-016/017/021/022a/043; lifecycle reworked by 032,
 * FR-017/FR-018/FR-019).
 *
 * ══ WHAT 032 CHANGED, AND WHY IT HAD TO ══
 *
 * This tab used to apply on a 300 ms debounce: type, pause, and whatever was in the buffer was
 * written. The reported symptom was that the caret jumped to line 1 column 1 a few keystrokes in,
 * and then that a banner appeared saying the file had changed on disk. Both were true, and both were
 * throng doing it to itself.
 *
 * A half-typed value is frequently still VALID JSON. `10` on its way to `15` is `1` for a moment,
 * which parses — so it was applied. Main wrote it, 031's bounds guard found it out of range on the
 * read back, corrected it, and WROTE THE CORRECTION BACK. That document differs from what this tab
 * last applied, so the tab saw an external change and either adopted it (moving the caret) or raised
 * a conflict banner about a change the user had just caused by typing.
 *
 * No amount of tuning fixes that, because the premise is wrong: **nothing should be writing this
 * document while the user is editing it.** So the debounce is gone. The buffer is applied when the
 * user LEAVES — closing the JSON view, switching tab, or closing the Preferences window.
 *
 * ══ ONE NOTICE, NOT THREE ══
 *
 * An invalid document used to produce three different messages: this inline banner, a toast when a
 * tab switch was refused, and a strip at the top of the window when a close was refused. One
 * condition, three wordings, two of them announcing that the user could not leave — while a Discard
 * button sat a few pixels away making that untrue.
 *
 * There is now exactly one, here, and it says what is wrong rather than what the user may not do.
 * The exits it governs are real, and pressing one FLASHES this notice instead of raising another.
 */
export interface JsonTabProps {
  docId: ConfigDocId;
}

function keyOf(docId: ConfigDocId): string {
  return docId.kind === 'theme' ? `theme:${docId.name}` : docId.kind;
}

/** The file name the user knows, so a message can name it rather than a document kind. */
function fileNameOf(docId: ConfigDocId): string {
  switch (docId.kind) {
    case 'settings':
      return 'settings.json';
    case 'keybindings':
      return 'keybindings.json';
    case 'theme':
      return `${docId.name}.json`;
  }
}

/**
 * One thing wrong with the buffer.
 *
 * A union rather than a single shape, because the two cases carry genuinely different information: a
 * bad VALUE has a setting behind it — a label, a key, a permitted set — while a document that will
 * not parse at all has only the parser's sentence. Flattening them would mean inventing a key for
 * the second, and a notice that names a setting which is not the problem is worse than one that
 * names nothing.
 */
type JsonProblem =
  | { kind: 'setting'; problem: SettingsProblem }
  | { kind: 'document'; text: string };

/**
 * What is wrong with `text`.
 *
 * SETTINGS get the full registry check (FR-019): the key, why it was rejected, and either its
 * allowed options or its permitted range, read from `SETTINGS_METADATA`. Key bindings and themes get
 * the JSON-parse check only — they have no equivalent registry of per-value constraints, and
 * inventing one here would be a second source of truth for documents this feature does not otherwise
 * touch.
 */
function problemsIn(
  docId: ConfigDocId,
  text: string,
  knownThemes: readonly string[],
): JsonProblem[] {
  if (docId.kind === 'settings') {
    const validity = checkSettingsText(text, { knownThemes });
    if (validity.kind === 'checked') {
      return validity.problems.map((problem) => ({ kind: 'setting' as const, problem }));
    }
    if (validity.kind === 'not-an-object') return [{ kind: 'document', text: validity.message }];
    const where =
      validity.line !== undefined && validity.column !== undefined
        ? ` at line ${validity.line}, column ${validity.column}`
        : '';
    return [
      { kind: 'document', text: `This is not valid JSON${where}.` },
      { kind: 'document', text: validity.message },
    ];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [{ kind: 'document', text: 'The document must be a JSON object — it starts with { and ends with }.' }];
    }
    return [];
  } catch (err) {
    return [
      { kind: 'document', text: 'This is not valid JSON.' },
      { kind: 'document', text: err instanceof Error ? err.message : String(err) },
    ];
  }
}

/** The notice as plain text, for the clipboard. One wording, two presentations. */
function problemsAsText(problems: readonly JsonProblem[]): string {
  return [
    'This document is not valid:',
    ...problems.map((p) => `- ${p.kind === 'setting' ? formatSettingsProblem(p.problem) : p.text}`),
  ].join('\n');
}

export function JsonTab({ docId }: JsonTabProps): ReactElement {
  const docKey = keyOf(docId);
  const gate = useJsonEditGate();
  const copy = useCopyToClipboard();
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<JsonProblem[]>([]);
  /** The on-disk document that arrived while the user had unsaved edits — `null` when there is none. */
  const [external, setExternal] = useState<string | null>(null);
  /**
   * Bumped every time an exit is refused.
   *
   * Used as a React `key` on the notice, so the element remounts and its CSS animation replays. A
   * class toggled on and off cannot do this reliably: re-adding a class in the same frame it was
   * removed does not restart an animation, and the timer-based dance around that is a race.
   */
  const [refusals, setRefusals] = useState(0);

  /*
   * Refs, not state, for everything the GATE reads.
   *
   * The gate is consulted at the instant the user tries to leave — from a tab click, the mode
   * toggle, or an IPC message from main. Reading React state there would mean reading whatever was
   * captured when the gate's callbacks were last created, which for an IPC handler is mount time. A
   * ref is always current, and none of this is rendered.
   */
  const textRef = useRef('');
  const dirtyRef = useRef(false);
  const loadedRef = useRef('');
  /**
   * The themes that exist on disk, for validating `appearance.theme` (FR-019c).
   *
   * A ref as well as state: the gate reads it synchronously at the moment the user tries to leave,
   * and state read from a callback created at mount would be the empty array forever.
   */
  const knownThemesRef = useRef<readonly string[]>([]);

  /*
   * Fetched once per mount. The list arrives over IPC AFTER the editor is on screen, so until it
   * does nothing is checked — permissive on purpose, because reporting a theme as unknown while the
   * list of known themes is still empty would be reporting a problem that does not exist.
   */
  useEffect(() => {
    let active = true;
    void window.throng?.config
      ?.listThemes?.()
      .then((themes) => {
        if (!active || !Array.isArray(themes)) return;
        knownThemesRef.current = themes;
        // Re-validate what is already on screen: the buffer may have been sitting there naming a
        // theme we could not check a moment ago. `setProblems` is also what re-renders, which is why
        // the list itself needs no state of its own.
        setProblems(problemsIn(docId, textRef.current, themes));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Load the raw document text when the target document changes (incl. the
  // selected theme on the Themes JSON tab, FR-022a).
  useEffect(() => {
    let active = true;
    void window.throng?.config?.readRaw?.(docId).then((raw) => {
      if (!active) return;
      setText(raw);
      textRef.current = raw;
      loadedRef.current = raw;
      dirtyRef.current = false;
      setProblems(problemsIn(docId, raw, knownThemesRef.current));
      setExternal(null);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  const onChange = (value: string): void => {
    setText(value);
    textRef.current = value;
    dirtyRef.current = value !== loadedRef.current;
    /*
     * NOTHING IS WRITTEN HERE (FR-017). This used to be `scheduleWrite(docId, …, 300)`.
     *
     * The validity check still runs on every keystroke, because the notice is meant to be live —
     * a user fixing a value should watch the complaint about it disappear. Checking is cheap and
     * touches no file; it is the WRITING that had to stop.
     */
    setProblems(problemsIn(docId, value, knownThemesRef.current));
  };

  /** Adopt `raw` as the buffer and as the baseline — the shape every reload path shares. */
  const adopt = (raw: string): void => {
    setText(raw);
    textRef.current = raw;
    loadedRef.current = raw;
    dirtyRef.current = false;
    setProblems(problemsIn(docId, raw, knownThemesRef.current));
    setExternal(null);
  };

  /** Throw the buffer away and go back to the document currently in effect (FR-018a). */
  const discard = (): void => adopt(loadedRef.current);

  /**
   * Register with the shell's gate, so leaving applies and an invalid buffer refuses.
   *
   * Re-registered whenever the document changes, because each document is a different buffer with
   * its own validity — and unregistered on unmount, so a shell that no longer shows a JSON editor
   * cannot be blocked by one that has gone.
   */
  useEffect(() => {
    const commit = (): void => {
      // Unchanged text is not a write. Writing it anyway would touch the file's timestamp, wake
      // the watcher and broadcast a change that nobody made — noise the whole feature is removing.
      if (!dirtyRef.current) return;
      loadedRef.current = textRef.current;
      dirtyRef.current = false;
      void writeConfig(docId, textRef.current);
    };

    gate.register({
      /*
       * A CLEAN BUFFER NEVER BLOCKS, whatever it contains.
       *
       * FR-018 exists to stop the user losing EDITS. A buffer they have not touched holds no edits:
       * its content is exactly what is on disk, leaving it writes nothing, and blocking achieves
       * nothing except keeping them there.
       *
       * That is not a nicety — it is the fix for a trap with no exit. The Themes tab's JSON document
       * is the ACTIVE theme's file, so an active theme with no file behind it (deleted by another
       * program, or named by a hand-edit) opens this editor on an empty, unparseable buffer the user
       * never typed into. Every exit then refused, including *Discard* (which restores that same
       * empty baseline) and *Discard and close* (refused by the close gate for the same reason).
       * Reported as: "the user is stuck on the Themes page forever. The only way out is closing
       * throng entirely."
       *
       * FR-018a promised the window could always be closed. It could not, because it assumed the
       * baseline was always something valid to fall back to.
       */
      isValid: () =>
        !dirtyRef.current ||
        problemsIn(docId, textRef.current, knownThemesRef.current).length === 0,
      commit,
      onRefused: () => setRefusals((n) => n + 1),
    });

    /*
     * THE FOURTH EXIT (032, FR-020).
     *
     * FR-017 names three apply triggers — closing the JSON view, switching tab, closing the
     * Preferences window. Closing the whole APPLICATION with Preferences open is a fourth, and none
     * of the three cover it: the app-close path tears the renderer down without any of them firing.
     *
     * Without this the buffer is silently discarded, which is the exact failure class this feature
     * exists to remove — and it would be a REGRESSION, because the old debounce at least had an
     * armed timer for the drain to fire.
     *
     * A VALID buffer only: the drain cannot ask the user anything, and writing a document that does
     * not parse would put the app in the state FR-018 blocks the user from creating deliberately.
     */
    const offDrain = registerPendingCommit(() => {
      if (problemsIn(docId, textRef.current, knownThemesRef.current).length === 0) commit();
    });

    return () => {
      gate.register(null);
      offDrain();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, gate]);

  /**
   * A CLEAN buffer follows the file; a DIRTY one keeps the user's text and offers the choice.
   *
   * ══ WHY CLEAN ADOPTS SILENTLY ══
   *
   * If the user has typed nothing here, there is nothing of theirs to protect and nothing to ask
   * about. Showing the file is simply showing the truth, and a notice would be reporting an event
   * with no consequence. It is also what 015 FR-013b needs: a reset performed from the toolbar while
   * the JSON view is open must refresh the visible document, and pressing a button is not typing.
   *
   * The caret survives it — `StandaloneEditor` preserves and clamps the selection across a
   * programmatic sync, so following the file does not move the cursor.
   *
   * ══ WHY DIRTY ASKS ══
   *
   * Two documents now disagree and only the user knows which one they meant. Overwriting their
   * buffer loses work they can see; overwriting the file loses work they cannot. So both are
   * offered by name — *Reload From Disk* and *Overwrite With These Changes* — rather than one being
   * chosen for them and described afterwards.
   */
  useEffect(() => {
    const off = window.throng?.config?.onChange?.(() => {
      void window.throng?.config?.readRaw?.(docId).then((raw) => {
        if (raw === loadedRef.current || raw === textRef.current) return; // our own write, echoed
        if (dirtyRef.current) {
          setExternal(raw);
          return;
        }
        adopt(raw);
      });
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  /** Keep the buffer and put it on disk now, replacing what arrived there. */
  const overwriteWithBuffer = (): void => {
    setExternal(null);
    if (!dirtyRef.current) return;
    loadedRef.current = textRef.current;
    dirtyRef.current = false;
    void writeConfig(docId, textRef.current);
  };

  const invalid = problems.length > 0;

  return (
    <div className="json-tab" data-testid={`json-tab-${docId.kind}`}>
      <StandaloneEditor value={text} onChange={onChange} testId={`json-editor-${docId.kind}`} />

      {external !== null ? (
        <div className="json-tab__external" data-testid="json-external-change">
          <p>
            <strong>{fileNameOf(docId)}</strong> has changed on disk.
          </p>
          <button type="button" data-testid="json-external-reload" onClick={() => adopt(external)}>
            Reload From Disk
          </button>
          <button
            type="button"
            data-testid="json-external-overwrite"
            onClick={overwriteWithBuffer}
          >
            Overwrite With These Changes
          </button>
        </div>
      ) : null}

      {!invalid ? (
        /*
         * THE STANDING EXPLANATION — shown whenever there is no error to show instead.
         *
         * FR-017 is the least discoverable thing about this editor: nothing is written while you
         * type, and there is no moment where the app appears to save. A user who does not know that
         * reads the silence as "my changes are being lost", which is what happened — the behaviour
         * was reported as a bug by the person who asked for it.
         *
         * So the rule is stated on screen, permanently, rather than left to be inferred. It occupies
         * the SAME slot as the invalidity notice because the two are alternatives: while a document
         * is invalid the user has a more urgent thing to read, and stacking both would push the
         * editor up for no gain.
         *
         * The second sentence is the one that earns its place. Because the buffer is only written on
         * leaving, a change made to the file by anything else — a text editor, another tool — is
         * overwritten when the user leaves, and that is genuinely a way to lose work. The dirty-buffer
         * branch of the external-change notice exists to catch it; this says so before it happens.
         *
         * Amber, not red: `--throng-colour-warning` is documented as exactly this — "a warning is
         * not a failure, and colouring it red would" overstate it. Nothing here has gone wrong.
         */
        <div className="json-tab__warning" data-testid="json-unsaved-warning">
          This file will not be saved until you switch back to the UI, switch tab, or close
          preferences. Editing <strong>{fileNameOf(docId)}</strong> directly whilst in JSON editing
          mode here may result in data loss.
        </div>
      ) : (
        /*
         * `key={refusals}` remounts this on every refused exit so the flash animation replays. It is
         * the one notice for this condition — there is no toast and no second strip, and it says what
         * is WRONG rather than what the user may not do, because Discard means they always may.
         */
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
            <button
              type="button"
              data-testid="json-copy-problems"
              onClick={() => copy(problemsAsText(problems), { kind: 'none' })}
            >
              Copy
            </button>
            <button type="button" data-testid="json-discard" onClick={discard}>
              Discard
            </button>
            <button
              type="button"
              data-testid="json-discard-and-close"
              onClick={() => {
                discard();
                window.throng?.window?.close?.();
              }}
            >
              Discard and close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
