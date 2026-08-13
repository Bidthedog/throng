import { toDisplayPath } from '@throng/core';

import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import type { PanelFailureCopy } from '../common/notice-text.js';
import { useEditorState } from './editor-state.js';

/**
 * WHAT AN EDITOR'S FAILURE BANNER IS ABOUT (030 US5, FR-042c/FR-052).
 *
 * Two surfaces present the same failure and must copy the same four facts: the banner
 * (`editor-failure-banner.tsx`) and the panel's own menu (`workspace/panel-placeholder.tsx`,
 * FR-042c). Assembling them twice is how the menu's copy and the banner's copy come to disagree
 * about a path or a headline within a release — so they are assembled once, here, and both read it.
 *
 * `null` when the panel is not in its failure state, which is what both call sites gate on: a
 * command offered while there is nothing wrong is noise, and a banner rendered then is a lie.
 */
export function useEditorFailure(panelId: string): PanelFailureCopy | null {
  const state = useEditorState(panelId);
  const place = usePanelPlace(panelId);
  if (!state?.unloadable) return null;
  const os = window.throng?.osName ?? 'windows';
  return {
    // The ONE per-type sentence (FR-040). Everything else about the banner belongs to the shared
    // component, and everything else about the copy belongs to `panelFailureText`.
    headline: 'This file could not be read',
    subject: panelSubject(place),
    detail: {
      path: state.filePath ? toDisplayPath(state.filePath, os) : undefined,
      // Never rendered (FR-034) — Copy and the diagnostic log are its only routes to the user.
      systemError: state.unloadableDetail,
    },
  };
}
