import { useCallback, useRef, useState, type ReactElement } from 'react';
import { IconButton } from './icon-button.js';
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
 * Only the {@link PanelFailureBannerProps.headline} and the path. Layout, spacing, colours, control
 * order, accessible names, the pointer sentence and the retry-failure sentence all belong here, and
 * the E2E proves it structurally: `panel-failure-banner.e2e.ts` compares the two panel types' root
 * class list, role and control names rather than their words, because two independently-written
 * banners can agree on labels and cannot agree on a class list by accident.
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
 * There are two controls and neither closes the banner. *Clear panel type* is not a close button:
 * it says "I no longer want this panel to be this type", which is a different decision with a
 * different consequence. The banner goes when its CONDITION goes — including while the panel is off
 * screen, which is why the condition is the caller's state and never this component's.
 *
 * ══ WHAT ARRIVES IN US5 ══
 *
 * The third control (*Copy details*, the `copy` token), the `subject` and `systemError` it copies,
 * and the final pointer sentence. Until then the pointer names the diagnostic log and nothing else:
 * FR-041 forbids it from promising a route that may not exist, and US4 itself proves the banner
 * appears with every severity set to *Never display* (T056), so a notice cannot be promised and
 * neither can a copy control that has not been built (T063). Props for the parts US5 needs are
 * deliberately NOT declared here — a prop no call site can use is speculation, not preparation.
 */
export interface PanelFailureBannerProps {
  panelId: string;
  /** The ONE per-type sentence: what could not be done, in this panel type's terms (FR-040). */
  headline: string;
  /** The path involved, ready to display. Required in both panel types where there is one (FR-040a). */
  detail?: { path?: string };
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

/** Where the detail is, while US5's copy control does not exist yet (FR-041, T063). */
const POINTER = 'Details are in the diagnostic log.';

/** Fixed wording, not the implementer's choice (FR-040b) — a test on it is otherwise vacuous. */
const RETRY_FAILED = 'That did not work — the condition is still there.';

export function PanelFailureBanner({
  panelId,
  headline,
  detail,
  onRetry,
  onCancel,
}: PanelFailureBannerProps): ReactElement {
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  // A retry in flight when the caller re-renders must not have its result applied twice, and a
  // second click must not start a second attempt — the control is disabled, and this is the belt.
  const inFlight = useRef(false);

  const retry = useCallback((): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setRetryFailed(false);
    void (async () => {
      let ok = false;
      try {
        ok = await onRetry();
      } finally {
        inFlight.current = false;
        setRetrying(false);
        // Only the FAILURE is reported. On success the condition has gone and this banner unmounts
        // with it; saying so anyway would flash a message about a state that has just ended.
        setRetryFailed(!ok);
      }
    })();
  }, [onRetry]);

  return (
    <div className="panel-failure" data-testid={`panel-failure-${panelId}`} role="status">
      <div className="panel-failure__text">
        <strong className="panel-failure__headline">{headline}</strong>
        {detail?.path ? <span className="panel-failure__path">{detail.path}</span> : null}
        {retryFailed ? <span className="panel-failure__retry-failed">{RETRY_FAILED}</span> : null}
        <span className="panel-failure__pointer">{POINTER}</span>
      </div>
      {/*
        Two controls, in a fixed order, identical in every panel type (FR-042/FR-042d), each a
        themeable icon resolving a theme token with a hover title (FR-042b, Constitution VI). The
        labels are 029's own, unchanged, which is what keeps the terminal's shipped behaviour and
        its tests describing the same thing they always did.
      */}
      <IconButton
        token="retry"
        title="Try again"
        className="icon-button panel-failure__control"
        disabled={retrying}
        onClick={retry}
      />
      <IconButton
        token="dismiss"
        title="Clear panel type"
        className="icon-button panel-failure__control"
        onClick={onCancel}
      />
    </div>
  );
}
