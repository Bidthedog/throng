/**
 * Every editor panel's DISPLAYED name, told to main (044 FR-031; contracts/preview-ipc.md §1
 * `publishEditorTitle`).
 *
 * A parented preview is titled `<parent editor's name> - Preview`, where the name is whatever that
 * editor currently displays — a custom name, or the one derived from its file. The name is decided in
 * the renderer (`panelDisplayTitle` over the layout's title and the editor's live file) and main holds
 * the layout only as an opaque blob, so each window publishes what its editors are called; main keeps
 * the latest per editor panel and forwards it on each preview's update as `parent.title`. A preview
 * stores no link to its editor (FR-013), so this is the only route the name has.
 *
 * ══ EVERY EDITOR IN THE LAYOUT, NOT ONLY THE MOUNTED ONES ══
 *
 * An editor in a background tab is not rendered, and its file may still have a preview in another
 * window. So the publisher walks the layout rather than waiting for editor views to mount.
 *
 * ══ ONLY WHEN THE NAME CHANGES ══
 *
 * The layout is rewritten by a zoom, a tab switch or a resize; the editor state by every dirty flip.
 * Publishing on each would send an IPC message per frame of a drag for a name that did not move, so
 * the last name sent per panel is remembered and only a different one is sent. The name is the
 * UNBOUNDED one: the preview applies its own length limit to its name half (FR-032), and a name
 * shortened here first would be shortened twice.
 *
 * Mounted once per window by `EditorChrome`, beside the other window-wide editor listeners.
 */
import { useEffect, useRef } from 'react';
import { collectPanels, panelDisplayTitle, type Panel } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { getEditorState, useEditorStateVersion } from './editor-state.js';

export function EditorTitlePublisher(): null {
  const { layout } = useWorkspace();
  // Re-run when any editor's live state changes — its file may be what names it.
  const editorStateVersion = useEditorStateVersion();
  const sent = useRef(new Map<string, string>());

  useEffect(() => {
    const publish = window.throng?.preview?.publishEditorTitle;
    if (!layout || !publish) return;
    const editors = layout.tabs
      .flatMap((tab) => collectPanels(tab.root) as Panel[])
      .filter((p) => p.kind === 'editor');
    const present = new Set<string>();
    for (const panel of editors) {
      present.add(panel.id);
      const configPath = typeof panel.config?.filePath === 'string' ? panel.config.filePath : null;
      const title = panelDisplayTitle(panel, {
        editorFilePath: getEditorState(panel.id)?.filePath ?? configPath,
      });
      if (sent.current.get(panel.id) === title) continue;
      sent.current.set(panel.id, title);
      publish(panel.id, title);
    }
    // A panel that left this layout is forgotten, so it is published afresh if it comes back.
    for (const id of [...sent.current.keys()]) if (!present.has(id)) sent.current.delete(id);
  }, [layout, editorStateVersion]);

  return null;
}
