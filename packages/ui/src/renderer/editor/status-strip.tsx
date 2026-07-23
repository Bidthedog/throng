import { useEffect, useRef, useState, type ReactElement } from 'react';
import { languageName } from '@throng/core';
import { usePanelLanguage } from './editor-language.js';
import { LanguagePicker } from './language-picker.js';
import { registerPickerOpener, unregisterPickerOpener } from './picker-request.js';
import { useEditorState } from './editor-state.js';
import { useAppSettings } from '../config/config-store.js';
import {
  wordWrapDocKey,
  useDocumentWordWrap,
  toggleDocumentWordWrap,
} from './word-wrap-store.js';

/**
 * The editor status strip (016, FR-010) — the band along the bottom of an Editor Panel showing the
 * document's language.
 *
 * It exists because US1's result is otherwise INVISIBLE: without it, a user cannot tell whether the
 * editor decided their file is C++ or plain text, and an undetectable file has no correction path.
 * Clicking the language opens the picker, which is the second of the two entry points FR-010 asks
 * for (the other is the content menu's "Set Language…").
 *
 * It dims with its panel, exactly as 012's other panel indicators do — a strip left brightly lit
 * while every other panel dimmed would contradict the very indicator it sits beside. It reuses
 * 012's `activePanelBorder` / `activePanelBorderInactive` treatment rather than inventing a
 * parallel pair (FR-010g).
 */
export interface StatusStripProps {
  panelId: string;
  /** Project id + project-relative path — what the override is persisted against. */
  projectId: string | null;
  relPath: string | null;
}

export function StatusStrip({ panelId, projectId, relPath }: StatusStripProps): ReactElement {
  const resolution = usePanelLanguage(panelId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const name = languageName(resolution?.languageId ?? 'plaintext');

  // 024 US1: the word-wrap toggle. Keyed by the open file's path (per document, Principle XI) so it
  // and the editor view read the one value; seeded from the editor default preference.
  const wrapSeed = useAppSettings().editor.defaultWordWrap;
  const filePath = useEditorState(panelId)?.filePath ?? null;
  const wrapDocKey = wordWrapDocKey(filePath, panelId);
  const wrapOn = useDocumentWordWrap(wrapDocKey, wrapSeed);

  // The content menu's "Set Language…" opens THIS picker (FR-010/FR-012) — the strip owns it,
  // because the strip is what it is anchored to. A second picker rendered by the menu would be free
  // to disagree with this one about which language is selected.
  useEffect(() => {
    registerPickerOpener(panelId, () => setPickerOpen(true));
    return () => unregisterPickerOpener(panelId);
  }, [panelId]);

  /**
   * Click anywhere off the picker and it closes.
   *
   * It used to close on Escape, and on choosing a language, and on nothing else — so a user who
   * opened it by accident, or thought better of it, had to guess a keyboard shortcut to be rid of a
   * menu that otherwise followed them around the app.
   *
   * The listener lives HERE rather than in the picker, and watches the whole STRIP rather than just
   * the menu, because the strip owns the open state and the button is a TOGGLE. Watching only the
   * menu would treat a click on the button as "outside", close the menu on `mousedown`, and let the
   * toggle reopen it on `click` — the picker would appear to ignore its own button. Anything inside
   * the strip is the picker's business; everything else dismisses it.
   */
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!stripRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    // Capture, so a handler that stops propagation on its way up cannot leave the menu stranded.
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [pickerOpen]);

  // The dimming is driven from 012's OWN panel classes in CSS (`.panel-box--active`,
  // `.panel-box--active-dimmed`) rather than re-derived here. Re-deriving it would be a second
  // copy of "is this panel active, and is its window in front?" — free to drift from the indicator
  // it is supposed to agree with.
  return (
    <div
      className="editor-status-strip"
      data-testid={`editor-status-strip-${panelId}`}
      ref={stripRef}
    >
      <button
        type="button"
        className="editor-status-strip__language"
        data-testid={`editor-language-${panelId}`}
        // The language indicator is an ACTION CONTROL, so it carries a hover title naming the
        // action (constitution, NON-NEGOTIABLE). Its LABEL is the language name — that is data,
        // not a control label, so the icon rule's text-label ban does not apply to the name itself.
        title="Set language"
        aria-haspopup="dialog"
        onClick={() => setPickerOpen((open) => !open)}
      >
        {name}
      </button>
      <button
        type="button"
        className="editor-status-strip__wrap"
        data-testid={`editor-word-wrap-${panelId}`}
        title="Toggle word wrap (Ctrl+Alt+W)"
        aria-pressed={wrapOn}
        onClick={() => toggleDocumentWordWrap(wrapDocKey, wrapSeed)}
      >
        {wrapOn ? 'Wrap' : 'No Wrap'}
      </button>
      {pickerOpen && (
        <LanguagePicker
          panelId={panelId}
          projectId={projectId}
          relPath={relPath}
          current={resolution?.languageId ?? 'plaintext'}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
