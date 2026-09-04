import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { NoticeSubject } from '@throng/core';
import { IconButton } from './icon-button.js';
import { useNotify } from './notification.js';
import { panelFailureText } from './notice-text.js';
import { attemptRetry } from './panel-retry.js';
import { useCopyToClipboard } from './use-copy.js';
import './panel-failure-banner.css';

/**
 * ONE FAILURE BANNER, EVERY PANEL TYPE (030 US4 / #236, FR-039).
 *
 * ══ WHY THIS EXISTS ══
 *
 * An editor that could not read its file and a terminal that could not start its shell used to say
 * so in two unrelated pieces of markup — `editor/unloadable-banner.tsx` and the
 * `terminal-panel__starting` failure strip — which agreed on nothing but their intent. Two designs
 * for one idea is one too many (SC-009), and a third panel type would have made it three. This is
 * the component a new panel type USES rather than copies.
 *
 * ══ WHAT IS PER-TYPE, AND WHAT IS NOT ══
 *
 * Only the {@link PanelFailureBannerProps.headline}, the path, and the optional
 * {@link PanelFailureBannerProps.note}. Layout, spacing, colours, control order, accessible names,
 * the pointer sentence and the retry-failure sentence all belong here, and the E2E proves it
 * structurally: `panel-failure-banner.e2e.ts` compares the two panel types' root class list, role
 * and control names rather than their words, because two independently-written banners can agree on
 * labels and cannot agree on a class list by accident.
 *
 * ══ THE PATH IS NOT DECORATION (FR-040a) ══
 *
 * It stays visible in BOTH panel types — the editor's unreadable file and the terminal's working
 * directory. 027 (#161) FR-011 makes it load-bearing: an editor holding a recovered buffer over a
 * path throng could not open looks entirely ordinary, and a Ctrl+S would write the remembered text
 * back over that path. For the terminal it is 029 FR-004's requirement that a start failure names
 * its folder — the headline does not contain it, so removing the path here would silently delete a
 * shipped requirement.
 *
 * ══ NOT DISMISSIBLE (FR-046) ══
 *
 * There are three controls and none of them closes the banner. *Clear panel type* is not a close
 * button: it says "I no longer want this panel to be this type", which is a different decision with
 * a different consequence. The banner goes when its CONDITION goes — including while the panel is
 * off screen, which is why the condition is the caller's state and never this component's.
 *
 * ══ COPY IS WHY THE POINTER SENTENCE CHANGED (030 US5 / #238, FR-051/FR-053) ══
 *
 * US4 shipped two controls and pointed at the diagnostic log, because that was the only route that
 * was unconditionally true: a notice may have been dismissed, timed out, or never displayed at all
 * (US1 lets a user silence a whole severity, and T056 proves the banner still appears when they
 * have). FR-041 forbids a pointer from promising a route that may not exist.
 *
 * The copy control removes that constraint by being the route that always exists. It is added ONCE,
 * here, rather than per panel type — which is the same reason this component exists at all — and it
 * copies the four facts FR-052 names, through `panelFailureText`. `subject` is a REQUIRED prop for
 * that reason: a banner that could not say which panel it was about would copy a paragraph the
 * reader cannot place, which is #195 one level down.
 */
export interface PanelFailureBannerProps {
  panelId: string;
  /** The ONE per-type sentence: what could not be done, in this panel type's terms (FR-040). */
  headline: string;
  /**
   * A SECOND per-type sentence, where a panel type carries a shipped requirement the headline
   * cannot hold (026 `contracts/editor-unloadable.md` P3, via 030 FR-039).
   *
   * ══ WHY THIS PROP EXISTS AT ALL ══
   *
   * FR-039 confines per-type wording to the headline, and it was written to stop TWO DIVERGENT
   * BANNERS — not to forbid a panel type from carrying a sentence it is required to say. Read the
   * strict way, the migration to this component silently dropped 026 P3: the editor's banner used to
   * say *"What is shown here is not the file."*, and that sentence is the only thing on screen
   * telling a user that the text under it is a REMEMBERED buffer rather than the file, over a path
   * throng could not read. `unloadable` guards no save path anywhere in the renderer today (026 P6
   * is not implemented renderer-side), so it was also the only in-panel warning that Ctrl+S would
   * write that remembered text back — the very scenario FR-040a cites as its own reason for keeping
   * the path visible.
   *
   * So it is one OPTIONAL line, in the shared component, rendered with the shared tokens and in a
   * fixed position — which is the opposite of the divergence FR-039 forbids. The terminal passes
   * none, and the structural E2E is unaffected: root class list, role and control set are identical
   * either way.
   */
  note?: string;
  /**
   * WHICH panel this is about, for the copied text (FR-052).
   *
   * Required, and structured: `formatSubject` renders it in the full `Project — Tab — Panel` form
   * because a copied paragraph carries no surrounding context to elide against. Never a string —
   * that would let each call site spell the form its own way, which is the defect 030 US2 closed.
   */
  subject: NoticeSubject;
  /**
   * The path involved, ready to display (FR-040a), and the raw system error (FR-052).
   *
   * The path RENDERS; the system error does NOT (FR-034) and reaches the user only through Copy and
   * the diagnostic log. For a silenced severity those two are the whole of its route.
   */
  detail?: { path?: string; systemError?: string };
  /**
   * Re-attempt the operation that failed (FR-045).
   *
   * Resolves `true` when the condition cleared — the caller's state drops the banner with it, so
   * this component says nothing on success. Resolves `false` when it did not, which is the only
   * case this component reports.
   */
  onRetry: () => Promise<boolean>;
  /** Clear the panel's type: back to the panel-type selection screen, panel intact (FR-043/FR-044). */
  onCancel: () => void;
}

/**
 * Where the detail is (FR-041, T069b) — fixed wording, not the implementer's choice.
 *
 * Copy LEADS, because it always works. The notification is the secondary route precisely because it
 * may have been dismissed, timed out or silenced, and a pointer that promised it first would be
 * false in exactly the case the user most needs it to be true.
 */
const POINTER = 'Copy the details here, or see the notification.';

/** Fixed wording, not the implementer's choice (FR-040b) — a test on it is otherwise vacuous. */
const RETRY_FAILED = 'That did not work — the condition is still there.';

/**
 * THE MOUNTED BANNERS' OWN RETRIES, BY PANEL — so the menu item is the SAME COMMAND (FR-042c).
 *
 * ══ THE DEFECT THIS CLOSES ══
 *
 * FR-042c makes the panel menu's *Try again* the same command as the banner's control, and FR-045
 * requires a failed retry to remain and say so. But each menu ran the underlying operation DIRECTLY
 * — `getEditorActions(id).reloadFromDisk()` and the terminal's `retryStart()` — so neither ever
 * touched the banner's retry state. Retrying from the menu left the banner standing, saying nothing,
 * which is precisely the "did my click do anything?" failure `terminal-panel.tsx` records the design
 * as existing to prevent. The requirement held on the button and nowhere else.
 *
 * A module registry rather than a prop because the two surfaces are far apart in the tree: the
 * terminal's menu is built in `terminal-panel.tsx` and the editor's in `workspace/panel-placeholder
 * .tsx`, neither of which renders the banner. It is the same idiom `editor-actions.ts` already uses
 * for the editor's imperative commands, and it is per-window by construction — a sub-workspace runs
 * its own module instance, so a banner in one window can never be driven from another.
 */
const MOUNTED_RETRIES = new Map<string, () => void>();

/**
 * Run the banner's OWN retry for `panelId` — state, disabling and failure report included.
 *
 * `false` when no banner is mounted for that panel, which is not a case any caller has to handle
 * today: every menu offering this command is itself gated on the failure that renders the banner.
 * The value is returned so that a future caller which is NOT so gated cannot silently do nothing.
 */
export function retryPanelFailure(panelId: string): boolean {
  const run = MOUNTED_RETRIES.get(panelId);
  if (!run) return false;
  run();
  return true;
}

export function PanelFailureBanner({
  panelId,
  headline,
  note,
  subject,
  detail,
  onRetry,
  onCancel,
}: PanelFailureBannerProps): ReactElement {
  const copy = useCopyToClipboard();
  const { notify } = useNotify();
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  // A retry in flight when the caller re-renders must not have its result applied twice, and a
  // second click must not start a second attempt — the control is disabled, and this is the belt.
  // It is also what makes the menu item safe: a menu has no disabled state to borrow.
  const inFlight = useRef(false);

  const retry = useCallback((): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setRetryFailed(false);
    void (async () => {
      let ok = false;
      try {
        // `attemptRetry` never rejects: a REJECTING `onRetry` is a different failure from the one
        // this banner is about, and it is raised through the notice model rather than disappearing
        // into a `void`ed promise. Before it existed, the only `catch` here was the absence of one.
        ok = await attemptRetry(onRetry, subject, { notify });
      } finally {
        inFlight.current = false;
        setRetrying(false);
        // Only the FAILURE is reported. On success the condition has gone and this banner unmounts
        // with it; saying so anyway would flash a message about a state that has just ended.
        setRetryFailed(!ok);
      }
    })();
  }, [onRetry, subject, notify]);

  // Published for as long as this banner is on screen — the menus' *Try again* runs THIS, so the
  // retry state, the in-flight guard and the failure sentence are shared rather than bypassed.
  useEffect(() => {
    MOUNTED_RETRIES.set(panelId, retry);
    return () => {
      // Only if it is still ours: a re-registration for the same id has already replaced it, and
      // deleting unconditionally on the old effect's cleanup would unpublish the live one.
      if (MOUNTED_RETRIES.get(panelId) === retry) MOUNTED_RETRIES.delete(panelId);
    };
  }, [panelId, retry]);

  return (
    <div className="panel-failure" data-testid={`panel-failure-${panelId}`} role="status">
      <div className="panel-failure__text">
        <strong className="panel-failure__headline">{headline}</strong>
        {detail?.path ? <span className="panel-failure__path">{detail.path}</span> : null}
        {/*
          The per-type note (026 P3), directly under the path it is about and ABOVE the retry
          result — it states a standing fact about the panel's content, so it must not read as
          something the last retry produced.
        */}
        {note ? <span className="panel-failure__note">{note}</span> : null}
        {retryFailed ? <span className="panel-failure__retry-failed">{RETRY_FAILED}</span> : null}
        <span className="panel-failure__pointer">{POINTER}</span>
      </div>
      {/*
        Three controls, in a fixed order, identical in every panel type (FR-042/FR-042d), each a
        themeable icon resolving a theme token with a hover title (FR-042b, Constitution VI). The
        labels are 029's own, unchanged, which is what keeps the terminal's shipped behaviour and
        its tests describing the same thing they always did.
      */}
      <IconButton
        token="retry"
        title="Try again"
        className="panel-failure__control"
        disabled={retrying}
        onClick={retry}
      />
      {/*
        COPY, in the MIDDLE (FR-051). Never a literal glyph: `copy` is a theme token, and the theme
        ships `⎘` for it — a component that hard-coded 📋 would ignore the user's icon pack and
        render something the rest of the application does not use.
      */}
      <IconButton
        token="copy"
        title="Copy details"
        className="panel-failure__control"
        onClick={() => copy(panelFailureText({ headline, subject, detail }), subject)}
      />
      <IconButton
        token="dismiss"
        title="Clear panel type"
        className="panel-failure__control"
        onClick={onCancel}
      />
    </div>
  );
}
