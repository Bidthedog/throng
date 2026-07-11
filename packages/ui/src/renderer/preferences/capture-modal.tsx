import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  captureToken,
  isBindableChord,
  isReservedChord,
  findConflict,
  applyAdd,
  applyReassign,
  type ActionId,
  type CaptureEvent,
} from '@throng/core';
import { chordKey } from '../config/chord-key.js';

/**
 * Key-binding capture modal (feature 007, FR-031/032/032a/033/033a/034). While
 * open it captures keydowns globally, showing the forming chord live; on key-up it
 * validates and commits:
 *  - a bare key / lone modifier is rejected (modifier+key required, FR-033a);
 *  - a reserved OS/window-control combo is surfaced as unavailable, not saved (FR-032a);
 *  - a chord already bound elsewhere warns and offers Reassign / Cancel (FR-034);
 *  - otherwise it replaces the action's chord(s) (FR-033) and closes.
 * The commit is a new bindings map handed to `onApply`; the parent writes it.
 */
export interface CaptureModalProps {
  action: ActionId;
  label: string;
  bindings: Record<string, string[]>;
  onApply: (next: Record<string, string[]>) => void;
  onClose: () => void;
}

function fromDomEvent(e: KeyboardEvent): CaptureEvent {
  // Normalise the backtick physical key so a captured `Ctrl+Shift+`` matches how it
  // resolves at runtime regardless of layout (012 — see chordKey).
  return { key: chordKey(e), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

/** DOM `key` values that are themselves modifiers (not the chord's key). */
const MODIFIER_KEY_NAMES = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'CapsLock',
  'ContextMenu',
  'Dead',
]);

export function CaptureModal({ action, label, bindings, onApply, onClose }: CaptureModalProps): ReactElement {
  const [live, setLive] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ action: ActionId; token: string } | null>(null);
  const candidateRef = useRef<string | null>(null);

  useEffect(() => {
    const evaluate = (token: string): void => {
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
        setConflict({ action: other, token });
        return;
      }
      // Additive: the captured chord is ADDED to the action's chords (FR-033).
      onApply(applyAdd(bindings, action, token));
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      // Bare Escape closes the capture without binding.
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onClose();
        return;
      }
      const token = captureToken(fromDomEvent(e));
      setLive(token);
      setError(null);
      setConflict(null);
      // A real (non-modifier) key press forms the candidate evaluated on key-up —
      // even a bare key, so the "modifier required" rejection is surfaced (FR-033a).
      if (!MODIFIER_KEY_NAMES.has(e.key)) candidateRef.current = token;
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const token = candidateRef.current;
      if (token) {
        candidateRef.current = null;
        evaluate(token);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [action, bindings, onApply, onClose]);

  return (
    <div className="capture-overlay" data-testid="capture-modal" role="dialog" aria-modal="true">
      <div className="capture-modal">
        <h3 className="capture-modal__title">Bind “{label}”</h3>
        <p className="capture-modal__hint">Press the key combination…</p>
        <div className="capture-modal__chord" data-testid="capture-live">
          {live || '—'}
        </div>
        {error ? (
          <p className="capture-modal__error" data-testid="capture-error">
            {error}
          </p>
        ) : null}
        {conflict ? (
          <div className="capture-modal__conflict" data-testid="capture-conflict">
            <p>
              <code>{conflict.token}</code> is already bound to <strong>{conflict.action}</strong>.
            </p>
            <div className="capture-modal__buttons">
              <button
                type="button"
                data-testid="capture-reassign"
                className="capture-modal__btn capture-modal__btn--primary"
                onClick={() => onApply(applyReassign(bindings, conflict.action, action, conflict.token))}
              >
                Reassign
              </button>
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
