import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ConfigDocId } from '@throng/core';
import { scheduleWrite, cancelWrite } from '../config/write-config.js';
import { StandaloneEditor } from '../editor/standalone-editor.js';

/**
 * A JSON editor tab (feature 007, US5 — FR-016/017/021/022a/043). Loads the raw
 * on-disk text for its document (so a malformed file shows verbatim for repair),
 * applies a valid, settled edit via config.write (immediate-apply), and surfaces
 * invalid JSON without applying it (last valid state remains). Each instance is an
 * independent buffer (no shared document). External on-disk changes reload a CLEAN
 * buffer; against a DIRTY buffer they are surfaced as a conflict offering reload
 * (adopt the external document) or keep-editing (the next apply overwrites) — never
 * silently discarding either side (FR-041).
 */
export interface JsonTabProps {
  docId: ConfigDocId;
}

function keyOf(docId: ConfigDocId): string {
  return docId.kind === 'theme' ? `theme:${docId.name}` : docId.kind;
}

export function JsonTab({ docId }: JsonTabProps): ReactElement {
  const docKey = keyOf(docId);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  // The on-disk document that landed while this buffer was dirty, awaiting the
  // user's reload/keep choice. `null` when there is no unresolved conflict.
  const [external, setExternal] = useState<string | null>(null);
  const lastAppliedRef = useRef('');
  const dirtyRef = useRef(false);

  // Load the raw document text when the target document changes (incl. the
  // selected theme on the Themes JSON tab, FR-022a).
  useEffect(() => {
    let active = true;
    void window.throng?.config?.readRaw?.(docId).then((raw) => {
      if (!active) return;
      setText(raw);
      lastAppliedRef.current = raw;
      dirtyRef.current = false;
      setInvalid(false);
      setExternal(null);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  /**
   * The apply body, run by the write module at FIRE time (019 C26). Returns the document to
   * write, or `null` to write NOTHING.
   *
   * This stays a thunk rather than a finished JSON string precisely because it is more than a
   * write: it decides WHETHER to write (an unparseable buffer must not reach the config file,
   * FR-017), and its echo-suppression and dirty/external bookkeeping must run when the write
   * does — not per keystroke at the call site, where clearing `dirtyRef` before the write lands
   * would break FR-041.
   */
  const applyBody = (v: string): string | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      setInvalid(true); // not applied; last valid state remains (FR-017)
      return null;
    }
    setInvalid(false);
    // Main canonicalises on write (pretty JSON + trailing newline); record that
    // exact form so the watcher's echo (readRaw) equals lastApplied and the
    // buffer is NOT reflowed under the cursor on our own apply (external changes,
    // which differ, still reload a clean buffer).
    lastAppliedRef.current = `${JSON.stringify(parsed, null, 2)}\n`;
    dirtyRef.current = false;
    // Applying resolves any outstanding conflict: this is the "keep editing,
    // your next apply overwrites" branch of FR-041.
    setExternal(null);
    return v;
  };

  const onChange = (v: string): void => {
    setText(v);
    dirtyRef.current = v !== lastAppliedRef.current;
    // Scheduled through the write MODULE, keyed by document (019 FR-010, C25/C26), so a close
    // can settle it. It also dissolves the orphan this tab used to strand: the debounce
    // instance was memoised on `docKey`, so re-rendering with a new `docId` — which is what
    // happens here, rather than an unmount — minted a fresh one and left the old one's armed
    // timer to fire with nobody holding it. Per-id keying means there is no instance to mint.
    scheduleWrite(docId, () => applyBody(v), 300);
  };

  // External-change reflection (FR-041). A CLEAN buffer reloads to the on-disk
  // content (external wins). A DIRTY buffer is never overwritten, but neither is
  // the external change swallowed: it is surfaced for the user to reload or keep
  // editing — no silent clobber in either direction.
  useEffect(() => {
    const off = window.throng?.config?.onChange?.(() => {
      void window.throng?.config?.readRaw?.(docId).then((raw) => {
        if (raw === lastAppliedRef.current) return; // the echo of our own write
        if (dirtyRef.current) setExternal(raw);
        else {
          setText(raw);
          lastAppliedRef.current = raw;
        }
      });
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  /** Adopt the external document, abandoning the in-progress edit (FR-041). */
  const reload = (): void => {
    if (external === null) return;
    // A debounced apply of the edit we are abandoning must not fire afterwards
    // and silently write it back over the document we just adopted.
    cancelWrite(docId);
    setText(external);
    lastAppliedRef.current = external;
    dirtyRef.current = false;
    setInvalid(false);
    setExternal(null);
  };

  /** Dismiss the conflict and keep editing; the next valid apply overwrites (FR-041). */
  const keepEditing = (): void => setExternal(null);

  return (
    <div className="json-tab" data-testid={`json-tab-${docId.kind}`}>
      <StandaloneEditor value={text} onChange={onChange} testId={`json-editor-${docId.kind}`} />
      {external !== null ? (
        <div className="json-tab__conflict" data-testid="json-conflict">
          <span>This file changed on disk while you were editing it.</span>
          <button type="button" data-testid="json-conflict-reload" onClick={reload}>
            Reload
          </button>
          <button type="button" data-testid="json-conflict-keep" onClick={keepEditing}>
            Keep editing
          </button>
        </div>
      ) : null}
      {invalid ? (
        <div className="json-tab__error" data-testid="json-invalid">
          Invalid JSON — not applied. The last valid document is still in effect.
        </div>
      ) : null}
    </div>
  );
}
