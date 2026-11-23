import { useEffect, useRef, useState, type ReactElement } from 'react';
import { checkSettingsText, formatSettingsProblem, type ConfigDocId } from '@throng/core';
import { registerPendingCommit, writeConfig } from '../config/write-config.js';
import { StandaloneEditor } from '../editor/standalone-editor.js';
import { useCopyToClipboard } from '../common/use-copy.js';
import { useJsonEditGate } from './json-edit-gate.js';
import { JsonDocumentNotice, type JsonProblem } from './json-document-notice.js';
import { logCaught, logExpected } from '@throng/core';

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
    logExpected('json-tab: parse the edited document', 'the user is mid-edit or typed invalid JSON; shown in the tab as a problem', err);
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

export function JsonTab({ docId: requested }: JsonTabProps): ReactElement {
  const requestedKey = keyOf(requested);
  /**
   * The document this tab is EDITING — which is not always the one the shell asks for (#707).
   *
   * The Themes JSON view is handed the ACTIVE theme, and `appearance.theme` is hot-reloaded: change
   * it anywhere else and the shell hands this tab another document while it may hold an unsaved
   * edit of the first. Following at once used to drop that edit silently — the gate was torn down
   * without committing, and the other theme was loaded over the buffer. FR-017 says nothing is
   * written until the user leaves, and FR-020a says an edited buffer is never swapped under them.
   *
   * So a CLEAN buffer follows the request immediately; a DIRTY one stays on its own document, and
   * the switch waits in `pending` until the user resolves it — leaving (the edit is written to the
   * document it was made in), Discard, or one of the two buttons the notice offers.
   *
   * Everything below reads `docId` / `docKey`, and both name the document being edited.
   */
  const [docId, setEditing] = useState<ConfigDocId>(requested);
  const docKey = keyOf(docId);
  const [pending, setPending] = useState<ConfigDocId | null>(null);
  /** The gate's commit and the drain read this at the moment of leaving, so a ref as well. */
  const pendingRef = useRef<ConfigDocId | null>(null);
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

  /**
   * The document key whose text has ARRIVED — the editor is offered only once it matches `docKey`.
   *
   * The load below is a round trip, and the tab mounts before it answers. An editor on screen in
   * that gap accepts typing, and the answer then lands on top of it: `setText(raw)` replaces the
   * buffer and clears `dirtyRef`, so the edit is gone from the screen AND leaving writes nothing —
   * the user's change is lost silently, with every exit still open. It was caught by
   * `preferences-json.e2e.ts:300` on a slow runner, and reproduced deterministically by holding the
   * `readRaw` answer until after the typing.
   *
   * Same rule, same reason, as the shell's `loaded` gate one level up (#341): nothing is editable
   * until what it edits is known. Keyed by document rather than a boolean, so a switch to another
   * document (the Themes tab following the active theme) closes the gap again instead of leaving the
   * previous document's text editable under the new document's name.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

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
      .catch((error: unknown) => logCaught('json-tab: list themes', error));
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
      setLoadedKey(docKey);
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

  /** Take up the document the shell asked for while the buffer was dirty, if there is one (#707). */
  const followPending = (): void => {
    const next = pendingRef.current;
    if (next === null) return;
    pendingRef.current = null;
    setPending(null);
    setEditing(next);
  };

  /*
   * The shell asked for another document. Follow it only when nothing of the user's would be lost;
   * otherwise hold it as pending and say so (FR-020a). Asked for this one again, the pending switch
   * is simply withdrawn.
   */
  useEffect(() => {
    if (requestedKey === docKey) {
      pendingRef.current = null;
      setPending(null);
      return;
    }
    if (dirtyRef.current) {
      pendingRef.current = requested;
      setPending(requested);
      return;
    }
    pendingRef.current = null;
    setPending(null);
    setEditing(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedKey]);

  /** Throw the buffer away and go back to the document currently in effect (FR-018a). */
  const discard = (): void => {
    adopt(loadedRef.current);
    followPending();
  };

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
      // To the document the edit was MADE in, which a pending switch has not changed (#707).
      void writeConfig(docId, textRef.current);
      followPending();
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
    if (dirtyRef.current) {
      loadedRef.current = textRef.current;
      dirtyRef.current = false;
      void writeConfig(docId, textRef.current);
    }
    followPending();
  };

  /** Reload From Disk: with a switch pending, "disk" is the document the shell now asks for. */
  const reloadFromDisk = (raw: string | null): void => {
    if (pendingRef.current !== null) {
      dirtyRef.current = false;
      setExternal(null);
      followPending();
      return;
    }
    if (raw !== null) adopt(raw);
  };


  return (
    <div className="json-tab" data-testid={`json-tab-${docId.kind}`}>
      {loadedKey === docKey ? (
        // Inside `.editor-panel`, so `editor.css` themes it exactly as an editor panel: background, text, gutter, caret,
        // active line and both selection colours, from the theme's editor tokens (007 FR-021a).
        <div className="editor-panel">
          <StandaloneEditor value={text} onChange={onChange} testId={`json-editor-${docId.kind}`} />
        </div>
      ) : null}

      {external !== null || pending !== null ? (
        <div className="json-tab__external" data-testid="json-external-change">
          {pending !== null ? (
            <p>
              {pending.kind === 'theme' ? (
                <>
                  The active theme is now <strong>{pending.name}</strong>.{' '}
                </>
              ) : (
                <>
                  <strong>{fileNameOf(pending)}</strong> was opened.{' '}
                </>
              )}
              Your unsaved changes to <strong>{fileNameOf(docId)}</strong> are still here.
            </p>
          ) : (
            <p>
              <strong>{fileNameOf(docId)}</strong> has changed on disk.
            </p>
          )}
          <button
            type="button"
            data-testid="json-external-reload"
            onClick={() => reloadFromDisk(external)}
          >
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

      <JsonDocumentNotice
        problems={problems}
        fileName={fileNameOf(docId)}
        refusals={refusals}
        onCopy={() => copy(problemsAsText(problems), { kind: 'none' })}
        onDiscard={discard}
        onDiscardAndClose={() => {
          discard();
          window.throng?.window?.close?.();
        }}
      />
    </div>
  );
}
