import { useState, type ReactElement } from 'react';
import { toDisplayPath } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { getEditorActions } from './editor-actions.js';
import { useEditorState } from './editor-state.js';

/**
 * "This is not your file" — the standing statement an editor makes while its path cannot be read
 * (027 / #161, FR-011).
 *
 * The issue reports a stranded editor as coming up EMPTY. It is worse than that: when a recovery
 * snapshot survives, the panel comes up holding the text the file used to have and looks entirely
 * ordinary, over a path throng could not open. Nothing on screen distinguished "this is your file"
 * from "this is what your file used to say" — and a Ctrl+S would have written the remembered text
 * back over that path.
 *
 * So the banner is not decoration on top of auto-recovery; it is the load-bearing half. It NAMES
 * the path it could not read, because the whole class of cause is a path that moved, and knowing
 * which one is what tells the user what to put back.
 *
 * The one-shot "cannot open file" dialog (FR-100) is a different affordance and stays exactly as it
 * was: it fires once, when a tab is opened, and it is dismissible. This states a condition, so it
 * is not dismissible — it goes when the condition does, whether by the auto-recovery noticing the
 * path came back or by the user pressing ↻.
 */
export function UnloadableBanner({ panelId }: { panelId: string }): ReactElement | null {
  const state = useEditorState(panelId);
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!state?.unloadable) return null;

  const os = window.throng?.osName ?? 'windows';
  const path = state.filePath ? toDisplayPath(state.filePath, os) : '(no file)';

  const retry = (): void => {
    setRetrying(true);
    setFailed(false);
    void (async () => {
      const ok = (await getEditorActions(panelId)?.reloadFromDisk()) ?? false;
      setRetrying(false);
      // Only report the FAILURE here. On success the banner unmounts with the state that raised
      // it, so there is nothing left to say — and saying it anyway would flash a message about a
      // condition that has just ended.
      setFailed(!ok);
    })();
  };

  return (
    <div className="editor-unloadable" data-testid={`editor-unloadable-${panelId}`} role="status">
      <div className="editor-unloadable__text">
        <strong className="editor-unloadable__title">This file could not be read</strong>
        <span className="editor-unloadable__path">{path}</span>
        <span className="editor-unloadable__note">
          {failed
            ? 'Still unreadable. Put the file (or its folder) back, and this editor will reload by itself.'
            : 'What is shown here is not the file. Restore the path and it reloads by itself, or reload it now.'}
        </span>
      </div>
      <IconButton
        token="retry"
        title="Reload from disk"
        testId={`editor-unloadable-retry-${panelId}`}
        className="icon-button editor-unloadable__retry"
        disabled={retrying}
        onClick={retry}
      />
    </div>
  );
}
