import { useCallback, useState, type CSSProperties, type ReactElement } from 'react';
import { zoomFactor, panelZoomLevel, type Panel } from '@throng/core';
import { useEditor } from './use-editor.js';
import { FindBar } from '../search/find-bar.js';
import { StatusStrip } from './status-strip.js';
import { toRelPath } from './language-override.js';
import { PanelSkeleton, useDelayedFlag } from '../common/loading.js';
import { useAppSettings } from '../config/config-store.js';
import './editor.css';

/**
 * The inline plain-text editor view for a confirmed Editor Panel (006 / FR-001).
 * Mounts a CodeMirror 6 view (via {@link useEditor}) bound to the document keyed
 * by the Panel id, themed by the active theme's editor colour tokens. Unlike a
 * terminal it is UI-main + renderer (no daemon): file I/O, the dirty-file lock,
 * recovery, and cross-window mirror all flow through the `editor.*` bridge.
 */
export function EditorPanel({
  panel,
  tabId,
  projectRoot,
  rootless = false,
  ownerProjectId,
}: {
  panel: Panel;
  tabId: string;
  projectRoot: string | null;
  rootless?: boolean;
  ownerProjectId?: string;
}): ReactElement {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Show a themed skeleton over the empty view until its content is adopted, so a
  // switch shows a loading placeholder rather than a blank editor that fills in
  // (issue 132 follow-up). `giveUp` is a safety net so the skeleton can never stick
  // if the ready signal is somehow missed.
  const [loaded, setLoaded] = useState(false);
  const onReady = useCallback(() => setLoaded(true), []);
  const giveUp = useDelayedFlag(4000);
  useEditor({ panel, tabId, projectRoot, rootless, ownerProjectId, container, onReady });
  // Per-panel editor zoom (012, per-instance): this panel's own zoom factor scales
  // only its CodeMirror text (editor.css `calc(... * var(--throng-zoom-editor))`).
  // Presentation only — file content, encoding and line endings are untouched.
  const zoomStyle = {
    ['--throng-zoom-editor']: String(zoomFactor(panelZoomLevel(panel))),
  } as CSSProperties;
  const filePath = (panel.config as { filePath?: string } | undefined)?.filePath ?? null;
  const showStatusBar = useAppSettings().editor.showStatusBar;
  return (
    <div className="editor-panel-wrap">
      <div
        className="editor-panel"
        data-testid={`editor-${panel.id}`}
        style={zoomStyle}
        ref={setContainer}
      />
      {!loaded && !giveUp && <PanelSkeleton testId={`editor-skeleton-${panel.id}`} />}
      {/* The one shared find bar (013); renders only while find is open on this panel. */}
      <FindBar panelId={panel.id} />
      {/* The language indicator (016, FR-010) — the ONLY way to see what the editor detected, and
          the way to correct it. It sits BELOW the text area (the wrap is a flex column), never
          over it. */}
      {/* 024 US1 (FR-001b/c): the status strip is preference-controlled. Hidden → its row is
          reclaimed for content, and the wrap command + language picker stay reachable by chord/menu. */}
      {showStatusBar && (
        <StatusStrip
          panelId={panel.id}
          projectId={ownerProjectId ?? null}
          relPath={toRelPath(projectRoot, filePath)}
        />
      )}
    </div>
  );
}
