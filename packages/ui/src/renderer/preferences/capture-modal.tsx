import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  COMMAND_SCOPES,
  MAX_CHORD_KEYS,
  captureChordToken,
  captureToken,
  isBindableChord,
  isReservedChord,
  isValidTwoStrokeToken,
  findConflict,
  isPrefixOfChord,
  parseChordStrokes,
  splitStrokes,
  applyAdd,
  applyReassign,
  type ActionId,
  type CaptureEvent,
} from '@throng/core';
import { candidateEvent, chordCandidates, effectiveShift, type ChordEventLike } from '../config/chord-key.js';

/**
 * Key-binding capture modal (feature 007, FR-031/032/032a/033/033a/034; 046 FR-124, FR-126). While
 * open it captures keydowns globally, showing the forming chord live, and records the press AS THE
 * USER MADE IT once every key, modifiers included, is released:
 *  - one key pressed under the held modifiers records `Mods+K`;
 *  - a second and third key pressed while those modifiers are still held record `Mods+K1,K2` and
 *    `Mods+K1,K2,K3` (a modifier added for a later key is part of that key, `Ctrl+E,Shift+W`);
 *  - a fourth key, or a later key struck after a first-key modifier was let go, is refused inline
 *    and DROPPED — releasing every key still records the chord as it stood, and the notice clears;
 *  - a bare key / lone modifier is rejected (FR-033a), a reserved OS combo is surfaced as
 *    unavailable (FR-032a), and a chord already bound elsewhere warns and offers Reassign / Cancel
 *    (FR-034); otherwise the chord is added to the action's chords (FR-033).
 * Bare Escape closes the box. The commit is a new bindings map handed to `onApply`; the parent writes
 * it.
 */
export interface CaptureModalProps {
  action: ActionId;
  label: string;
  bindings: Record<string, string[]>;
  onApply: (next: Record<string, string[]>) => void;
  onClose: () => void;
}

function fromDomEvent(e: ChordEventLike): CaptureEvent {
  // The key the window listener would try FIRST (046 R2): the physical digit for Ctrl+digit without
  // Alt, so pressing Ctrl+Shift+0 records `Ctrl+Shift+0` rather than the unmatchable `Ctrl+Shift+)`;
  // otherwise the produced key, with the backtick normalised from its physical key (012 — see
  // chordKey). The modifiers stay the event's own, so Shift and Meta are recorded as pressed.
  const [first] = chordCandidates(e);
  // Shift counts one Windows hid from a NumLock-ON keypad press (046 FR-120).
  return { key: first === undefined ? e.key : candidateEvent(first).key, ctrl: e.ctrlKey, alt: e.altKey, shift: effectiveShift(e), meta: e.metaKey ?? false };
}

/** DOM `key` values that are themselves modifiers (not the chord's key). */
const MODIFIER_KEY_NAMES = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'ContextMenu',
  'Dead',
]);

/** FR-126's refusal of a fourth key, verbatim (FR-124's "Only two keys…" before it). */
export const FOURTH_KEY_REFUSAL = 'Only three keys can follow the modifiers.';

/** A later key struck without every modifier the first key was pressed under (FR-124, FR-126). */
export const RELEASED_MODIFIER_REFUSAL = 'Keep the first key’s modifiers held for the next key.';

/** A conflict raised by a completed capture. */
interface Conflict {
  action: ActionId;
  token: string;
  /**
   * Set when the capture is a TWO-KEY chord whose FIRST STROKE is another action's whole chord
   * (review finding CRITICAL 3 on c0d85941, kept through FR-124): the other action fires first, so
   * the chord could never be reached. Reassign would move only the token it matches, never the first
   * stroke, so none is offered.
   */
  firstStroke?: boolean;
  /**
   * Set when `token` is a PLAIN, completed single-stroke capture that equals the first stroke of
   * `action`'s existing TWO-STROKE chord (branch-review finding, 046 FR-092) — e.g. capturing
   * `Ctrl+E` while `editor.toggleWordWrap` ships `Ctrl+E,W`. `action`'s real binding is the
   * two-stroke, not the bare stroke, so Reassign's exact-token removal would find nothing to take
   * off it and still hand the bare stroke to this action — leaving BOTH readings live. No Reassign.
   */
  prefixOfOther?: boolean;
}

/** One press in progress: the keys struck under the held modifiers, in order. */
interface Press {
  strokes: CaptureEvent[];
  /** Non-modifier keys currently down, by physical code (or key when no code is reported). */
  down: Set<string>;
}

const emptyPress = (): Press => ({ strokes: [], down: new Set() });

function keyId(e: KeyboardEvent): string {
  return e.code || e.key.toLowerCase();
}

function anyModifierHeld(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
}

export function CaptureModal({ action, label, bindings, onApply, onClose }: CaptureModalProps): ReactElement {
  const [live, setLive] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const pressRef = useRef<Press>(emptyPress());

  useEffect(() => {
    const evaluate = (token: string): void => {
      const strokes = parseChordStrokes(token);
      if (strokes && strokes.length > 1) {
        // FR-092: the first key needs a modifier held, and every stroke needs a real key.
        if (!isValidTwoStrokeToken(token)) {
          setError('A chord of several keys needs a modifier (Ctrl, Shift or Alt) held from the first key through the last.');
          return;
        }
        // FR-092: only a command whose scope contains no terminal may carry a multi-key chord — a
        // shell would take the first key as input, and the saved token is dropped on load.
        if (COMMAND_SCOPES[action]?.has('terminal')) {
          setError(`${label} also works in a terminal, which would take the first key as typing — a chord of several keys can’t be bound to it. Use a single key combination.`);
          return;
        }
        const reserved = strokes.find((stroke) => isReservedChord(stroke));
        if (reserved) {
          setError(`${reserved} is reserved by the system and can’t be bound.`);
          return;
        }
        const other = findConflict(bindings, token, action);
        if (other) {
          setConflict({ action: other, token, prefixOfOther: isPrefixOfChord(bindings, other, token) });
          return;
        }
        // Any shorter prefix doubling as another action's WHOLE chord makes this one unreachable
        // (FR-092, widened by FR-126). checkPrefixOfOthers=false: two different chords merely
        // sharing a prefix are legitimate.
        const written = splitStrokes(token) ?? [];
        for (let k = 1; k < written.length; k++) {
          const prefix = written.slice(0, k).join(',');
          const shadowing = findConflict(bindings, prefix, action, undefined, false);
          if (shadowing) {
            setConflict({ action: shadowing, token: prefix, firstStroke: true });
            return;
          }
        }
        onApply(applyAdd(bindings, action, token));
        return;
      }
      if (!isBindableChord(token)) {
        setError('That key can’t be bound on its own (Esc, Space, Enter, Tab, etc.). Try another key or add a modifier.');
        return;
      }
      if (isReservedChord(token)) {
        setError(`${token} is reserved by the system and can’t be bound.`);
        return;
      }
      const other = findConflict(bindings, token, action);
      if (other) {
        // FR-092 (branch-review fix round): a completed single-stroke capture that IS another
        // action's two-stroke first stroke is a real collision, but the other action's binding is
        // the two-stroke — not `token` — so Reassign has no exact match to take off it.
        setConflict({ action: other, token, prefixOfOther: isPrefixOfChord(bindings, other, token) });
        return;
      }
      // Additive: the captured chord is ADDED to the action's chords (FR-033).
      onApply(applyAdd(bindings, action, token));
    };

    /**
     * Every key is up: record the chord as it stands — a key refused mid-press was dropped, so a
     * refusal never leaves the box stuck (FR-126). The refusal notice clears as the chord is
     * recorded; evaluating it may raise a notice of its own.
     */
    const finish = (): void => {
      const { strokes } = pressRef.current;
      pressRef.current = emptyPress();
      setPending(null);
      if (strokes.length === 0) return;
      const token = strokes.length === 1 ? captureToken(strokes[0]) : captureChordToken(strokes);
      setError(null);
      // Never null: every kept later key was checked against the first key's modifiers as struck.
      if (token !== null) evaluate(token);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const press = pressRef.current;
      // Bare Escape closes the capture without binding.
      if (e.key === 'Escape' && !anyModifierHeld(e)) {
        pressRef.current = emptyPress();
        onClose();
        return;
      }
      if (press.strokes.length === 0 && press.down.size === 0) {
        // A fresh press: whatever the last one reported no longer applies.
        setError(null);
        setConflict(null);
      }
      if (MODIFIER_KEY_NAMES.has(e.key)) {
        if (press.strokes.length === 0) setLive(captureToken(fromDomEvent(e)));
        return;
      }
      if (e.repeat) return;
      // Held down until its keyup, refused or not, so the release that records waits for it.
      press.down.add(keyId(e));
      const ev = fromDomEvent(e);
      // A refused key is DROPPED and named inline; the chord as it stood is what the release records
      // (FR-126 — the box is never stuck by a refusal).
      if (press.strokes.length >= MAX_CHORD_KEYS) {
        setError(FOURTH_KEY_REFUSAL);
        return;
      }
      const shown = press.strokes.length === 0 ? captureToken(ev) : captureChordToken([...press.strokes, ev]);
      if (shown === null) {
        setError(RELEASED_MODIFIER_REFUSAL);
        return;
      }
      press.strokes.push(ev);
      setLive(shown);
      setPending(shown);
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const press = pressRef.current;
      if (!MODIFIER_KEY_NAMES.has(e.key)) press.down.delete(keyId(e));
      // Record only once EVERY key is up — the struck keys and every modifier (FR-124).
      if (press.down.size === 0 && !anyModifierHeld(e)) finish();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [action, label, bindings, onApply, onClose]);

  return (
    <div className="capture-overlay" data-testid="capture-modal" role="dialog" aria-modal="true">
      <div className="capture-modal">
        <h3 className="capture-modal__title">Bind “{label}”</h3>
        <p className="capture-modal__hint">
          Press the key combination. For a two-key chord, keep the modifiers held and press both keys.
        </p>
        <div className="capture-modal__chord-row">
          <div className="capture-modal__chord" data-testid="capture-live">
            {live || '—'}
          </div>
        </div>
        {pending ? (
          <p className="capture-modal__pending" data-testid="capture-pending">
            {pending} — release every key to record it.
          </p>
        ) : null}
        {error ? (
          <p className="capture-modal__error" data-testid="capture-error">
            {error}
          </p>
        ) : null}
        {conflict ? (
          <div className="capture-modal__conflict" data-testid="capture-conflict">
            <p>
              <code>{conflict.token}</code> is already bound to <strong>{conflict.action}</strong>.
              {conflict.firstStroke ? ' Choose a different first key.' : ''}
              {conflict.prefixOfOther
                ? ` It is the first stroke of ${conflict.action}'s key binding — choose a different key.`
                : ''}
            </p>
            <div className="capture-modal__buttons">
              {conflict.firstStroke || conflict.prefixOfOther ? null : (
                <button
                  type="button"
                  data-testid="capture-reassign"
                  className="capture-modal__btn capture-modal__btn--primary"
                  onClick={() => onApply(applyReassign(bindings, conflict.action, action, conflict.token))}
                >
                  Reassign
                </button>
              )}
              <button
                type="button"
                data-testid="capture-cancel"
                className="capture-modal__btn"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="capture-modal__buttons">
            <button type="button" className="capture-modal__btn" data-testid="capture-close" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
