import { useState, type CSSProperties, type ReactElement } from 'react';
import { zoomFactor, panelZoomLevel, type Panel } from '@throng/core';
import { useEditor } from './use-editor.js';
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
  useEditor({ panel, tabId, projectRoot, rootless, ownerProjectId, container });
  // Per-panel editor zoom (012, per-instance): this panel's own zoom factor scales
  // only its CodeMirror text (editor.css `calc(... * var(--throng-zoom-editor))`).
  // Presentation only — file content, encoding and line endings are untouched.
  const zoomStyle = {
    ['--throng-zoom-editor']: String(zoomFactor(panelZoomLevel(panel))),
  } as CSSProperties;
  return (
    <div
      className="editor-panel"
      data-testid={`editor-${panel.id}`}
      style={zoomStyle}
      ref={setContainer}
    />
  );
}
