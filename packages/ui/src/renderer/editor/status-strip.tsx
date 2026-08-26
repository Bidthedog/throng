import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { formatGrouped, languageName } from '@throng/core';
import { usePanelCaret, type PanelCaret } from './caret-store.js';
import { useDocumentMetrics, type DocumentMetrics } from './document-metrics-store.js';
import {
  READOUT_LABELS,
  fitReadouts,
  labelShortens,
  type LabelForm,
  type ReadoutId,
  type SegmentWidth,
} from './status-strip-fit.js';
import { usePanelLanguage } from './editor-language.js';
import { LanguagePicker } from './language-picker.js';
import { registerPickerOpener, unregisterPickerOpener } from './picker-request.js';
import { useFocusTrap } from '../common/focus-trap.js';
import { useTransientOverlay } from '../common/transient-overlay.js';
import { useEditorState } from './editor-state.js';
import { focusPanel } from '../workspace/panel-focus.js';
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
/**
 * The five figures the bar reports (040 data-model.md §5).
 *
 * Declared in `status-strip-fit.ts` with the hide order and the label forms, and re-exported here
 * so the id, the order it is dropped in and the label it is drawn with cannot drift into two lists.
 */
export type { ReadoutId };

/** One readout, ready to draw. */
export interface Readout {
  id: ReadoutId;
  /**
   * The grouped figure alone — `412`, `1,204`.
   *
   * Kept separate from {@link text} because the bar draws each readout TWICE: once visibly, and
   * once into the hidden ruler that measures both label forms. Composing the two from one figure is
   * what stops the measured string and the rendered string ever differing.
   */
  figure: string;
  /** Exactly what is drawn — `Ln 412`, `Col 7`, `63 selected`, `1,204 chars`, `208 words`. */
  text: string;
  /**
   * What a screen reader announces — `line 412`, never `Ln 412` and never `412` (FR-015).
   *
   * The abbreviated label above exists for sighted density; `Ln` is not a word, and a name that
   * spelled it out letter by letter would be a puzzle rather than a reading. Plural agreement is
   * part of it: this is a sentence somebody hears, and "1 characters" is the tell of a string that
   * was assembled and never read aloud.
   */
  accessibleName: string;
}

/**
 * A readout's visible string, at the label form it is being drawn with (FR-012, FR-022a).
 *
 * `Ln` and `Col` LEAD with their label; the three counts lead with their figure. That is FR-012's
 * own examples (`Ln 412`, `63 selected`) rather than a choice made here, and it lives in one
 * function so the visible readout and its ruler copy can never disagree about it.
 */
export function readoutText(id: ReadoutId, figure: string, form: LabelForm): string {
  const label = READOUT_LABELS[id][form];
  return id === 'line' || id === 'column' ? `${label} ${figure}` : `${figure} ${label}`;
}

/**
 * The bar's flex gap, in px — the same `6px` `editor.css` declares on `.editor-status-strip` and on
 * `.editor-status-strip__group`.
 *
 * Duplicated deliberately and narrowly: the fit arithmetic needs a number, and reading it back out
 * of the cascade would mean a `getComputedStyle` call per resize for a value that has not changed
 * since 016. If the rule moves, this moves with it — `status-strip-fit-wiring.test.ts` names the
 * same figure, so the two are checked together rather than only at a glance.
 *
 * **Exported for the guard, not for reuse** (040 T044a). The duplication is the right call and it
 * was, until then, unguarded: change `gap` in `editor.css` and this arithmetic goes quietly wrong
 * with every test in the suite still green, because nothing measures pixels at the tiers that run
 * cheaply. `status-strip-declared-css.test.ts` parses that stylesheet already, so it compares the
 * declared gap against this constant and turns a silent drift into a named failure.
 */
export const BAR_GAP = 6;

/** Whether two measurement tables agree, so an unchanged measurement causes no re-render. */
function sameWidths(
  a: Partial<Record<ReadoutId, SegmentWidth>>,
  b: Partial<Record<ReadoutId, SegmentWidth>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as ReadoutId[]);
  for (const key of keys) {
    if (a[key]?.full !== b[key]?.full || a[key]?.short !== b[key]?.short) return false;
  }
  return true;
}

/** `1 word` / `2 words` — the announced name is English, so it agrees in number. */
function plural(count: number, singular: string, figure: string, suffix = ''): string {
  return `${figure} ${singular}${count === 1 ? '' : 's'}${suffix}`;
}

/**
 * Turn the caret and the document's counts into what the bar SAYS (040 FR-012, FR-005, FR-027).
 *
 * ══ WHY THIS IS A FUNCTION RATHER THAN JSX INLINE ══
 *
 * Two reasons, and the second is the one that matters. It puts the five forms in one place, so
 * "the word is the label and the number is the figure" (FR-012) is a single rule rather than five
 * template literals that can drift apart. And it takes the LOCALE as an argument, which is what
 * makes AS8 — a locale grouping with `.` renders `1.048.576` — testable at all: `Intl` reads its
 * default from the runtime, and nothing a rendered component is handed can change that.
 *
 * ══ EVERY FIGURE IS GROUPED, INCLUDING THE LINE AND THE COLUMN ══
 *
 * Constitution 5.4.0 requires the one core formatter on every surface, with no magnitude threshold
 * — 4.5.0 removed 018's five-digit floor because a rule that changes shape halfway up a column is
 * harder to read than either rule applied consistently. So `formatGrouped` runs over all five, and
 * a small number simply comes back unchanged.
 *
 * ══ WHAT IS ABSENT, AND WHY ABSENT IS NOT ZERO ══
 *
 * No selection means NO selected readout (FR-005) — `0 selected` would claim a selection exists,
 * sit on screen permanently, and spend width the other readouts need. Counts that have not settled
 * yet (FR-008b grants 200 ms) are likewise omitted rather than rendered as `0 chars`, which would
 * be a wrong figure stated confidently.
 */
export function statusReadouts(
  caret: PanelCaret,
  metrics: DocumentMetrics | null,
  locale?: string,
  /** Label form per readout. Anything unnamed is drawn at its full form (FR-022a). */
  forms?: Partial<Record<ReadoutId, LabelForm>>,
): Readout[] {
  const n = (value: number): string => formatGrouped(value, locale);
  const text = (id: ReadoutId, figure: string): string =>
    readoutText(id, figure, forms?.[id] ?? 'full');

  const out: Readout[] = [
    {
      id: 'line',
      figure: n(caret.position.line),
      text: text('line', n(caret.position.line)),
      accessibleName: `line ${n(caret.position.line)}`,
    },
    {
      id: 'column',
      figure: n(caret.position.column),
      text: text('column', n(caret.position.column)),
      accessibleName: `column ${n(caret.position.column)}`,
    },
  ];
  // `!== null` rather than a truthiness test: **0 is a real answer here** and must still render as
  // a selection. FR-004a names the case — select-all in an EMPTY document is one zero-length range,
  // which reports 0 rather than `null`, because a selection genuinely exists.
  //
  // (This comment used to cite a range covering only a line ending. That example stopped being a
  // zero for the FR-003a reversal, which made a line break a counted character — so such a range
  // now reports 1. The guard was right for a reason that had expired underneath it.)
  if (caret.selected !== null) {
    out.push({
      id: 'selected',
      figure: n(caret.selected),
      text: text('selected', n(caret.selected)),
      accessibleName: plural(caret.selected, 'character', n(caret.selected), ' selected'),
    });
  }
  if (metrics !== null) {
    out.push({
      id: 'chars',
      figure: n(metrics.totalCharacters),
      text: text('chars', n(metrics.totalCharacters)),
      accessibleName: plural(metrics.totalCharacters, 'character', n(metrics.totalCharacters)),
    });
    out.push({
      id: 'words',
      figure: n(metrics.totalWords),
      text: text('words', n(metrics.totalWords)),
      accessibleName: plural(metrics.totalWords, 'word', n(metrics.totalWords)),
    });
  }
  return out;
}

export interface StatusStripProps {
  panelId: string;
  /** Project id + project-relative path — what the override is persisted against. */
  projectId: string | null;
  relPath: string | null;
  /** Mount with the language picker already open — the strip was revealed IN ORDER to show it. */
  autoOpenPicker?: boolean;
  /** The picker went from open to closed (chosen, dismissed, or Escaped). */
  onPickerClosed?: () => void;
}

export function StatusStrip({
  panelId,
  projectId,
  relPath,
  autoOpenPicker = false,
  onPickerClosed,
}: StatusStripProps): ReactElement {
  const resolution = usePanelLanguage(panelId);
  const [pickerOpen, setPickerOpen] = useState(autoOpenPicker);
  const name = languageName(resolution?.languageId ?? 'plaintext');

  /*
   * FR-071 — the language picker is a transient overlay too, and takes the window's one slot.
   *
   * Registered NOW rather than when it becomes the next `Ctrl+Alt+T` / `Ctrl+Shift+T`: it is the
   * third surface of this exact shape already in the codebase, it traps focus over the window, and
   * every reason FR-071 exists applies to it unchanged. One line, and nothing about it moves.
   */
  useTransientOverlay(pickerOpen, () => setPickerOpen(false));

  // Tell the panel when the picker closes, so a strip that is only on screen FOR the picker can go
  // away again (024 US1 follow-up). Edge-triggered: the panel must not be told on every render, and
  // a strip the preference keeps visible simply has nothing listening.
  //
  // Closing also hands the keyboard BACK to the editor. The picker takes focus when it opens (its
  // filter box), so choosing a language by keyboard used to leave the caret nowhere — the document
  // was re-highlighted in front of a user who then had to click into it to carry on typing. The
  // editor's own state still holds the cursor and selection, so focusing the view restores them.
  const wasOpen = useRef(pickerOpen);
  useEffect(() => {
    if (wasOpen.current && !pickerOpen) {
      onPickerClosed?.();
      focusPanel(panelId);
    }
    wasOpen.current = pickerOpen;
  }, [pickerOpen, onPickerClosed, panelId]);

  // 024 US1: the word-wrap toggle. Keyed by the open file's path (per document, Principle XI) so it
  // and the editor view read the one value; seeded from the editor default preference.
  const wrapSeed = useAppSettings().editor.defaultWordWrap;
  const filePath = useEditorState(panelId)?.filePath ?? null;
  const wrapDocKey = wordWrapDocKey(filePath, panelId);
  const wrapOn = useDocumentWordWrap(wrapDocKey, wrapSeed);

  /*
   * 040 US1 — the readouts. TWO stores, and the split is a Principle XI requirement rather than an
   * implementation detail (research.md D5):
   *
   *   the caret     keyed by PANEL    — view state; two panels on one file have two carets (FR-006)
   *   the counts    keyed by DOCUMENT — document state; every panel showing it must agree (FR-007)
   *
   * The counts reuse the word-wrap document key, so "the same document" means the same thing to
   * both features rather than two definitions that can disagree about an untitled buffer.
   */
  const caret = usePanelCaret(panelId);
  const metrics = useDocumentMetrics(wrapDocKey);

  /*
   * 040 US3 — the two readout preferences (FR-030, FR-031).
   *
   * TWO toggles for five figures, not five (FR-032): the caret's position is one answer, and the
   * three counts are one answer about the document, so each is one switch. `editor.showStatusBar`
   * is not consulted here at all — it hides the WHOLE bar and is read by `editor-panel.tsx`, which
   * is the component that can decline to render this one (FR-033).
   *
   * The filter runs BEFORE the fit and before the ruler, which is load-bearing three times over.
   * A readout the user has switched off must not reserve width the visible ones need (FR-014); it
   * must not be measured, because the ruler draws only what could be drawn; and it must be ABSENT
   * from the accessibility tree rather than hidden in it (FR-017) — an `aria-label` on a `display:
   * none` span is still read by some assistive technology, and "hidden" and "not there" are the
   * same requirement here.
   */
  const readoutPrefs = useAppSettings().editor.statusBar;
  const wanted = (id: ReadoutId): boolean =>
    id === 'line' || id === 'column' ? readoutPrefs.showCursorPosition : readoutPrefs.showCounts;

  /*
   * 040 US2 — how the bar gives way as the panel narrows (FR-021 … FR-026).
   *
   * ══ MEASURE, ASK, RENDER — AND WHY THERE IS A HIDDEN RULER ══
   *
   * The decision is `fitReadouts`, which is pure and is walked at every width by
   * `unit/status-strip-fit.test.ts`. What is left here is measurement, and measurement has one
   * trap: the width of a readout at its SHORT label cannot be read off a readout drawn at its full
   * one. Measuring only what is on screen means the first narrow pass has to guess, render, measure
   * again and possibly correct — a bar that visibly settles over two or three frames, and a
   * feedback loop between what is drawn and what is measured.
   *
   * The ruler removes the loop rather than damping it. It draws every PRESENT readout in BOTH forms,
   * hidden and out of flow, so both widths are known before the first decision is taken and the fit
   * is a pure function of numbers that do not depend on it. It is `aria-hidden` and carries no test
   * ids: it is a measuring stick, not content, and FR-016/FR-017 must not see it.
   *
   * ══ WHAT HAPPENS WITH NO ResizeObserver ══
   *
   * `available` starts at infinity, so everything renders at its full label until a measurement
   * arrives. That is the right default in three situations: the first paint before the observer
   * fires, a jsdom test that has not stubbed one (there is no `ResizeObserver` in jsdom at all), and
   * any environment where measurement fails. A bar that starts empty and fills in would flash on
   * every mount; one that starts full and tightens does not.
   */
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState(Number.POSITIVE_INFINITY);
  const [measured, setMeasured] = useState<{
    controls: number;
    widths: Partial<Record<ReadoutId, SegmentWidth>>;
  }>({ controls: 0, widths: {} });

  const present = statusReadouts(caret, metrics).filter((r) => wanted(r.id));
  const fit = fitReadouts({
    available: barWidth - measured.controls - BAR_GAP,
    // Only readouts that are PRESENT may be fitted. A readout absent because there is no selection
    // (FR-005) or because the counts have not settled (FR-008b) was never hidden by width, and the
    // hide order must not account for it.
    widths: Object.fromEntries(
      present.filter((r) => measured.widths[r.id]).map((r) => [r.id, measured.widths[r.id]]),
    ) as Partial<Record<ReadoutId, SegmentWidth>>,
    gap: BAR_GAP,
  });
  const forms = new Map(fit.segments.map((s) => [s.id, s.label]));
  const readouts = statusReadouts(
    caret,
    metrics,
    undefined,
    Object.fromEntries(forms) as Partial<Record<ReadoutId, LabelForm>>,
  ).filter((r) => forms.has(r.id));

  // Read the ruler after every render, and write back only when something actually moved — an
  // unconditional `setMeasured` here would re-render forever.
  //
  // The lint rule below fires on `setMeasured` in a dependency-less layout effect, and it is right
  // about the general shape: measure → setState → re-render → measure is an infinite chain. It
  // cannot see the guard that breaks it. The updater returns `prev` BY IDENTITY when nothing moved,
  // so React bails out of the re-render and the chain terminates after one pass. Running on every
  // render is deliberate: the ruler's widths change when the font, the theme or the digit count
  // changes, and none of those is expressible as a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const controls = controlsRef.current?.getBoundingClientRect().width ?? 0;
    const widths: Partial<Record<ReadoutId, SegmentWidth>> = {};
    for (const el of rulerRef.current?.children ?? []) {
      const key = el.getAttribute('data-measure');
      const [id, form] = (key ?? '').split(':') as [ReadoutId, LabelForm];
      if (!id || !form) continue;
      const width = el.getBoundingClientRect().width;
      // A label with no shorter form is drawn ONCE and stands for both (see the ruler below). Taking
      // the measured width for the missing form matters: leaving it at 0 would tell `fitReadouts`
      // that `Ln 412` costs nothing at its short label, and the bar would believe it always fits.
      widths[id] = labelShortens(id)
        ? { ...(widths[id] ?? { full: 0, short: 0 }), [form]: width }
        : { full: width, short: width };
    }
    setMeasured((prev) =>
      prev.controls === controls && sameWidths(prev.widths, widths) ? prev : { controls, widths },
    );
  });

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
  // While the picker is up, Tab belongs to the strip: the language list, the filter box and the
  // strip's own controls, and nothing else. It used to walk straight out of an open picker and into
  // the rest of the application — the file tree, the panels — leaving a menu on screen that the
  // keyboard had abandoned. The strip is the trapped region rather than the picker alone because the
  // strip is what the picker belongs to, and the user named its controls as part of the cycle.
  const trap = useFocusTrap<HTMLDivElement>(pickerOpen);

  // One ref serves both jobs: the trap needs the strip, and so does the outside-click dismissal —
  // they are asking the same question ("is this inside the strip?") about the same element.
  const stripRef = trap.ref;
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!stripRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    // Capture, so a handler that stops propagation on its way up cannot leave the menu stranded.
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [pickerOpen, stripRef]);

  /*
   * How wide the bar is (040 FR-021 … FR-026). Declared here rather than beside the fit above only
   * because `stripRef` is the focus trap's and is created below it — the effect order is what
   * matters to React, not the reading order.
   *
   * `contentRect` excludes padding, which is exactly what `available` wants. jsdom implements no
   * `ResizeObserver` at all, so the guard is not defensiveness: without it every component test
   * that renders this strip without a stub would throw on mount.
   */
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setBarWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // `stripRef` is stable; re-observing per render would tear the observer down mid-measurement.
  }, [stripRef]);

  // The dimming is driven from 012's OWN panel classes in CSS (`.panel-box--active`,
  // `.panel-box--active-dimmed`) rather than re-derived here. Re-deriving it would be a second
  // copy of "is this panel active, and is its window in front?" — free to drift from the indicator
  // it is supposed to agree with.
  return (
    <div
      className="editor-status-strip"
      data-testid={`editor-status-strip-${panelId}`}
      ref={stripRef}
      tabIndex={-1}
      onKeyDown={trap.onKeyDown}
    >
      {/* 040 FR-013 — the bar is split by ALIGNMENT: the readouts lead, the controls trail. The
          two groups are real elements rather than a `margin-left: auto` on one child, because
          FR-014 requires width pressure to be absorbed BETWEEN them, and a group is what a width
          can be given to. 016 FR-010c's "right-aligned label in a status strip" is preserved: the
          language indicator is in the trailing group, exactly where it already was. */}
      <div
        className="editor-status-strip__group editor-status-strip__group--readouts"
        data-testid={`editor-status-readouts-${panelId}`}
      >
        {readouts.map((r) => (
          <span
            key={r.id}
            className="editor-status-strip__readout"
            data-testid={`editor-status-${r.id}-${panelId}`}
            // Which readout this is, and which label form it settled on. Read by
            // `status-strip-fit-wiring.test.ts` to assert the rendered bar matches the decision —
            // group membership and label form are facts about the tree, which is all jsdom can see.
            data-readout={r.id}
            data-label={forms.get(r.id) ?? 'full'}
            /*
             * FR-015 — announced as "line 412", not as the abbreviation on screen. `aria-label`
             * OVERRIDES the element's text for assistive technology, which is exactly the intent:
             * the two forms carry the same figure and are addressed to different readers.
             *
             * FR-016 — and NOTHING here is a live region. No `aria-live`, no `role="status"`, no
             * `aria-atomic`, on this element or on anything above it. The caret moves on every
             * keypress and the editor already announces the line the user arrived at; a second
             * announcement would interrupt the first on every arrow key.
             */
            aria-label={r.accessibleName}
          >
            {r.text}
          </span>
        ))}
      </div>
      <div
        className="editor-status-strip__group editor-status-strip__group--controls"
        data-testid={`editor-status-controls-${panelId}`}
        // Measured, because the readouts get whatever the controls do not take: FR-024 says the
        // language indicator and the wrap toggle are never hidden by width, so they are subtracted
        // first and the readouts absorb the pressure (FR-014).
        data-measure="controls"
        ref={controlsRef}
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
          onClick={() => toggleDocumentWordWrap(wrapDocKey, wrapSeed, panelId)}
        >
          {wrapOn ? 'Wrap' : 'No Wrap'}
        </button>
      </div>
      {/*
        The RULER (040 FR-021, FR-022a). Every present readout, in both label forms, drawn where it
        can be measured and nowhere it can be seen or heard.

        It is what lets the fit be decided in ONE pass: the width of `1,204 ch` cannot be read off an
        element rendering `1,204 chars`, so without it the first narrow layout would have to guess,
        render, measure and correct — a bar that visibly settles, and a loop between what is drawn
        and what is measured.

        `aria-hidden` and no test ids and no `aria-label`, deliberately: a measuring stick is not
        content. That is what keeps FR-016 and FR-017 testable, because both are claims about what a
        screen reader finds and every query that can answer them — `getByRole`, `getByLabelText`,
        `getByTestId` — is blind to this element by construction.

        It is NOT invisible to `getByText`, which filters on neither `aria-hidden` nor `visibility`.
        Nothing in this area queries the bar by its text for that reason; go through the readouts'
        test ids. (An earlier version of this comment claimed the opposite, and the claim was wrong
        in both directions — the ruler does answer `getByText`, and FR-016/FR-017 are testable
        anyway.)

        ONE COPY PER DISTINCT LABEL FORM. `Ln` and `Col` are their own short form (FR-022a), so
        drawing both would put a second, character-identical copy of those two readouts in the
        document — measuring a width already known, and making `getByText('Ln 412')` match three
        elements where it now matches two.
      */}
      <div className="editor-status-strip__ruler" aria-hidden="true" ref={rulerRef}>
        {present.flatMap((r) =>
          (labelShortens(r.id) ? (['full', 'short'] as const) : (['full'] as const)).map((form) => (
            <span
              key={`${r.id}:${form}`}
              className="editor-status-strip__readout"
              data-measure={`${r.id}:${form}`}
            >
              {readoutText(r.id, r.figure, form)}
            </span>
          )),
        )}
      </div>
      {/* The picker stays a direct child of the STRIP, not of the trailing group: it is positioned
          against the strip's stacking context (`editor.css` `.language-picker`), and the
          outside-click dismissal asks whether a click landed inside the strip. */}
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
