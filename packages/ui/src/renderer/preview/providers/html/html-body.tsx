/**
 * The HTML provider's body (074 FR-070 – FR-093a; research R6, R6a – R6c, R6e): the page as static markup in a
 * same-origin frame that runs no script.
 *
 * The frame is `<iframe sandbox="allow-same-origin allow-popups" srcdoc name="throng-html-<panelId>">`:
 *
 * - `allow-same-origin` (FR-074a, 2026-11-20) — the frame shares the renderer's origin so the panel can draw a new
 *   version of the page into it in place (FR-071b), read and restore its scroll, search it, and hear its input and
 *   right-click directly (FR-083a, FR-085a);
 * - no `allow-scripts` — nothing runs, whatever the sanitiser missed; the page's own CSP grants no script source
 *   either, and the sanitiser removed every script (FR-074a: three layers, each refusing alone);
 * - no `allow-forms`, `allow-top-navigation*`, `allow-modals`, `allow-downloads` — no submission, no navigation of
 *   the panel, no dialog, no download (FR-076, FR-077);
 * - `allow-popups` only so a reader's **Ctrl+click** on a link reaches main's window-open guard, which denies every
 *   window and hands the link back to this panel to follow (FR-079).
 *
 * The frame's NAME is how main's request filter knows which panel a sub-frame request came from, so it can admit
 * that panel's safe sources and nothing else (R6c); the sources are registered with main before the frame loads.
 *
 * The text arrives from the chrome — the editor's unsaved buffer when parented, the disk otherwise (FR-071). The first
 * page is the frame's `srcdoc`; every later one is drawn into the same document (`html-frame-update.ts`), the reader's
 * scroll kept. Only a change of the safe sources reloads the frame: its content policy cannot be relaxed in place.
 * The panel's zoom scales the frame (FR-083) through the same CSS variable the Markdown body reads. The themed
 * defaults are read from the renderer's tokens HERE, as concrete colours (FR-082).
 *
 * A page that carried script says so while it is on screen, inline and dismissible — never a toast (FR-081a). A page
 * whose remote resources were left out says which, grouped by source, with Allow this source (FR-093a).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { htmlSafeSourcesFrom, safeSourceList } from '@throng/core';
import type { PreviewBodyProps } from '../../provider-view.js';
import { useActiveTheme, useAppSettings } from '../../../config/config-store.js';
import { useProjectsOptional } from '../../../state/projects-store.js';
import { IconButton } from '../../../common/icon-button.js';
import { sanitiseHtmlPage, type BlockedResource } from './html-sanitise.js';
import { readFrameScroll, updateFrameInPlace, writeFrameScroll, type FrameScroll } from './html-frame-update.js';
import { listenToFrameInput } from './frame-input.js';
import { listenToFrameFragments } from './frame-fragments.js';
import { BlockedResourcesNotice, blockedFromViolation } from './blocked-notice.js';
import './html.css';

/** The exact sandbox the frame carries (research R6a; pinned by `html-preview.test.ts`). */
export const HTML_FRAME_SANDBOX = 'allow-same-origin allow-popups';

/** The frame's name, by which main's request filter knows its panel (R6c; main's `frameNameFor`). */
export function htmlFrameName(panelId: string): string {
  return `throng-html-${panelId}`;
}

const SCRIPTS_NOTICE = 'Scripts in this page do not run in the preview.';
const TOP: FrameScroll = { x: 0, y: 0 };

function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** FR-107 — this body's view state: the frame's scroll. Anything else (another body's place, `null`) is the top. */
interface HtmlViewState {
  scrollX: number;
  scrollY: number;
}

function placeOf(state: unknown): FrameScroll {
  if (typeof state !== 'object' || state === null) return TOP;
  const { scrollX, scrollY } = state as Partial<HtmlViewState>;
  return typeof scrollX === 'number' && typeof scrollY === 'number' ? { x: scrollX, y: scrollY } : TOP;
}

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function HtmlBody({
  panelId,
  content,
  filePath,
  projectRoot,
  initialViewState,
  navigationSeq,
  onDrawn,
  onViewStateCapture,
  registerSelectionHost,
}: PreviewBodyProps): ReactElement {
  const text = content.kind === 'text' ? content.text : '';
  const theme = useActiveTheme();
  const settings = useAppSettings();
  const projects = useProjectsOptional();
  const project = projects?.projects.find((p) => samePath(p.rootFolder, projectRoot)) ?? null;

  /*
   * FR-082 — the theme's editor background and text colour, read from the document root, where the theme provider
   * sets the tokens, DURING render: the first page the frame is handed already carries them.
   */
  const defaults = useMemo((): { background: string; text: string } | undefined => {
    void theme; // re-read when the theme changes
    const style = getComputedStyle(document.documentElement);
    const background = style.getPropertyValue('--throng-colour-editorBg').trim();
    const colour = style.getPropertyValue('--throng-colour-text').trim();
    return background !== '' && colour !== '' ? { background, text: colour } : undefined;
  }, [theme]);

  // FR-072a — the global HTML: Safe preview sources, then this project's own, canonical and de-duplicated.
  const globalSources = htmlSafeSourcesFrom(settings.editor.previews);
  const projectSources = project?.htmlSafeSources;
  const sourcesKey = safeSourceList([...globalSources, ...(projectSources ?? [])]).join(' ');
  const safeSources = useMemo(() => (sourcesKey === '' ? [] : sourcesKey.split(' ')), [sourcesKey]);

  /*
   * FR-072 — each content the chrome delivers (an update, a Refresh) is a new revision of the page, named on its asset
   * URLs so the frame fetches the page's own stylesheets and fonts again, though the page's text is unchanged.
   */
  const revisionOf = useRef<{ content: unknown; revision: number }>({ content, revision: 0 });
  if (revisionOf.current.content !== content) revisionOf.current = { content, revision: revisionOf.current.revision + 1 };
  const revision = revisionOf.current.revision;

  const page = useMemo(
    () =>
      sanitiseHtmlPage(text, {
        panelId,
        docPath: filePath,
        projectRoot,
        safeSources,
        revision,
        ...(defaults ? { defaults } : {}),
      }),
    [text, panelId, filePath, projectRoot, defaults, safeSources, revision],
  );

  /*
   * The frame's document: its `srcdoc` is the page as it was when the frame was made, and stays that — a later page
   * is drawn into the document, never handed to the frame again (a second navigation of a frame blanks it). A change
   * of the sources makes a new frame (the render-phase update React sanctions for state derived from props).
   */
  const [frameBase, setFrameBase] = useState(() => ({ sources: sourcesKey, html: page.html, generation: 0 }));
  if (frameBase.sources !== sourcesKey) {
    setFrameBase({ sources: sourcesKey, html: page.html, generation: frameBase.generation + 1 });
  }

  // R6c — main admits this panel's sources for its frame's requests; registered before the frame first loads.
  useLayoutEffect(() => {
    window.throng?.preview?.setFrameSources?.(panelId, safeSources);
  }, [panelId, safeSources]);
  useEffect(() => () => window.throng?.preview?.setFrameSources?.(panelId, []), [panelId]);

  /*
   * FR-081a — the notice belongs to the PAGE: shown while the page on screen carried script, gone with that page,
   * and back for every page loaded with script. Dismiss holds for this page — through its live updates — and lapses
   * when another file is loaded.
   */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  useEffect(() => {
    setDismissedFor((d) => (d === filePath ? d : null));
  }, [filePath]);
  const showScripts = page.scriptsRemoved && dismissedFor !== filePath;

  /* ── In-place update and the reader's place (FR-071b, FR-107) ───────────────────────────────── */

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const docRef = useRef<Document | null>(null);
  // What the props ask for now, read by the frame's load handler as well as by the effect below.
  const latest = useRef({ html: page.html, place: initialViewState, navigation: navigationSeq });
  latest.current = { html: page.html, place: initialViewState, navigation: navigationSeq };
  // What the frame's document shows: the page, and the place and navigation last applied to it.
  const applied = useRef<{ html: string; place: unknown; navigation: number | undefined }>({
    html: frameBase.html,
    place: undefined,
    navigation: navigationSeq,
  });
  /** The reader's place as last seen in the frame — by the time a reload commits, the old document is gone. */
  const lastScroll = useRef<FrameScroll>(TOP);
  /** A reload's kept place: the old frame's scroll, restored in the new one. */
  const reloadPlace = useRef<FrameScroll | null>(null);

  // Runtime refusals the page's content policy reported (a font inside a remote stylesheet), for this page.
  const [violations, setViolations] = useState<BlockedResource[]>([]);

  const sync = useCallback((doc: Document, fresh: boolean): void => {
    const want = latest.current;
    const done = applied.current;
    if (want.html !== done.html) {
      updateFrameInPlace(doc, want.html);
      done.html = want.html;
    }
    if (fresh && reloadPlace.current !== null) {
      writeFrameScroll(doc, reloadPlace.current);
      reloadPlace.current = null;
    } else if (want.place !== undefined && (want.place !== done.place || fresh)) {
      // A place the chrome handed down (an attach, a history step): `null` names the top.
      writeFrameScroll(doc, placeOf(want.place));
    } else if (want.navigation !== done.navigation) {
      writeFrameScroll(doc, TOP); // a link followed: the new file from its top
    }
    done.place = want.place;
    done.navigation = want.navigation;
    lastScroll.current = readFrameScroll(doc);
  }, []);

  // A NEW frame (the sources changed) keeps the reader's place; its document is not the old one's.
  useLayoutEffect(() => {
    if (docRef.current !== null) reloadPlace.current = lastScroll.current;
    docRef.current = null;
  }, [frameBase]);

  useLayoutEffect(() => {
    const doc = docRef.current;
    if (doc !== null) sync(doc, false);
  }, [page.html, initialViewState, navigationSeq, sync]);

  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Removes the listeners in the frame's current document (another realm: no AbortSignal, see `frame-input.ts`).
  const stopListening = useRef<(() => void) | null>(null);
  useEffect(() => () => stopListening.current?.(), []);

  const onFrameLoad = useCallback((): void => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument ?? null;
    if (frame === null || doc === null) return;
    stopListening.current?.();
    const stopInput = listenToFrameInput(frame, doc);
    // FR-079 — a `#fragment` link follows on the gesture only (`frame-fragments.ts`).
    const stopFragments = listenToFrameFragments(doc);
    // FR-093a — a request the page's content policy refused at run time joins the notice's list.
    const onViolation = (e: SecurityPolicyViolationEvent): void => {
      const found = blockedFromViolation(e);
      if (found !== null) setViolations((list) => (list.some((b) => b.url === found.url) ? list : [...list, found]));
    };
    const onScroll = (): void => {
      lastScroll.current = readFrameScroll(doc);
    };
    doc.addEventListener('securitypolicyviolation', onViolation);
    doc.addEventListener('scroll', onScroll, { passive: true });
    stopListening.current = () => {
      stopInput();
      stopFragments();
      doc.removeEventListener('securitypolicyviolation', onViolation);
      doc.removeEventListener('scroll', onScroll);
    };
    docRef.current = doc;
    // The loaded document shows the frame's own `srcdoc`, whatever was applied to an earlier document.
    applied.current = { ...applied.current, html: frame.getAttribute('srcdoc') ?? '' };
    sync(doc, true);
    frame.dataset.loaded = 'true';
    // The page is in a document only now: what waits on a draw (an open find re-searching) runs again.
    onDrawnRef.current(filePathRef.current);
  }, [sync]);

  // Runtime refusals belong to the page that raised them: another file, or a reload, starts a clean list.
  useEffect(() => {
    setViolations([]);
  }, [filePath, frameBase]);

  // FR-107 — the frame's scroll is the place; the top is `null`, as every body reports it.
  useEffect(() => {
    onViewStateCapture(() => {
      const doc = docRef.current;
      if (doc === null) return null;
      const { x, y } = readFrameScroll(doc);
      return x === 0 && y === 0 ? null : ({ scrollX: x, scrollY: y } satisfies HtmlViewState);
    });
  }, [onViewStateCapture]);

  // FR-085a — the page's selection lives in the frame's document: the panel's Copy, Select All and menu read it there.
  useEffect(() => {
    if (registerSelectionHost === undefined) return undefined;
    registerSelectionHost(() => docRef.current?.body ?? null);
    return () => registerSelectionHost(null);
  }, [registerSelectionHost]);

  useEffect(() => {
    onDrawnRef.current(filePath);
  }, [page.html, filePath]);

  /* ── FR-093a — what the page could not load ─────────────────────────────────────────────────── */

  const blocked = useMemo(() => {
    const all = [...page.blocked];
    for (const v of violations) if (!all.some((b) => b.url === v.url)) all.push(v);
    return all;
  }, [page.blocked, violations]);

  const setHtmlSafeSources = projects?.setHtmlSafeSources;
  const allow =
    project !== null && setHtmlSafeSources !== undefined
      ? (source: string): void => {
          void setHtmlSafeSources(project.id, [...(project.htmlSafeSources ?? []), source]);
        }
      : null;

  return (
    <div className="preview-html" data-testid={`preview-html-${panelId}`}>
      {showScripts ? (
        <div className="preview-html__notice" role="status" data-testid={`preview-html-scripts-${panelId}`}>
          <span>{SCRIPTS_NOTICE}</span>
          <IconButton
            token="dismiss"
            title="Dismiss"
            onClick={() => setDismissedFor(filePath)}
            testId={`preview-html-scripts-dismiss-${panelId}`}
          />
        </div>
      ) : null}
      <BlockedResourcesNotice key={filePath} panelId={panelId} blocked={blocked} onAllow={allow} />
      <div className="preview-html__stage">
        <iframe
          key={frameBase.generation}
          ref={frameRef}
          className="preview-html__frame"
          title={`${basename(filePath)} — page preview`}
          name={htmlFrameName(panelId)}
          sandbox={HTML_FRAME_SANDBOX}
          srcDoc={frameBase.html}
          onLoad={onFrameLoad}
          data-testid={`preview-html-frame-${panelId}`}
        />
      </div>
    </div>
  );
}
