/**
 * The Print Preview window's app (075 FR-064, FR-068 – FR-071, FR-080, FR-081, research R11).
 *
 * Controls on the left, the page on the right. Main lays the document out as a PDF with the settings shown and
 * hands its bytes over; this app draws ONE page of it at a time, fitted whole to the page area (FR-068a). A page is
 * put on screen only once it is fully drawn — the one before stays until then, and a spinner stands in while there
 * is none yet — so the page never jumps from one size to another. Back and Forward, the mouse wheel over the page,
 * the arrow keys, Page Up and Page Down step through the pages that will print, and Home and End go to the first
 * and last; stepping lays nothing out again. A change to any control lays the pages out again, debounced, with
 * progress shown while it runs (SC-008). Print prints with exactly the settings the pages were laid out with, with
 * no OS dialog (Q4); a failure is one inline notice, and pressing Print again retries. Close, Escape and the title
 * bar close all save the settings, page range excepted.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement, type WheelEvent as ReactWheelEvent } from 'react';
import {
  PRINT_FIELDS,
  PRINT_PAGE_SIZES,
  paperSizeLabel,
  paperSizeMm,
  PRINT_PALETTE,
  formatGrouped,
  logCaught,
  marginsMm,
  parsePageRanges,
  type PrintJobView,
  type PrintMargins,
  type PrintMarginPreset,
  type PrintSettings,
} from '@throng/core';
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { Spinner } from '../common/loading.js';
import { openPrintPages, type PrintPages } from './print-pages.js';
import { NumberField, VALIDATE_IDLE_MS, type FieldState } from './number-field.js';

export { VALIDATE_IDLE_MS };
import './print-preview.css';

/** How long a control must be still before the pages are laid out again. */
export const RENDER_DEBOUNCE_MS = 300;

/** How far the wheel must travel, in pixels, to step one page: one notch of a mouse wheel; a trackpad gathers. */
export const WHEEL_STEP_PX = 50;

/** How long the wheel must be still before what it has gathered towards a step is dropped. */
const WHEEL_IDLE_MS = 250;

/** 2026-11-20 — how often the printer list is read again while the window is open, as the OS's own dialog does. */
export const PRINTER_REFRESH_MS = 3000;

/** The page area's padding around the page, in CSS px, each side. */
const PAGE_MARGIN_PX = 16;

type PrintBridge = NonNullable<NonNullable<Window['throng']>['print']>;

const MARGIN_LABELS: Record<PrintMarginPreset, string> = { default: 'Default', minimum: 'Minimum', none: 'None', custom: 'Custom' };

/** 2026-11-20 — the scales offered; any other is Custom. */
export const SCALE_CHOICES = [25, 50, 75, 100, 125, 150, 175, 200] as const;

/** The custom margins' edges, in the order a reader tabs through them. */
const EDGES = ['top', 'left', 'right', 'bottom'] as const;

export interface PrintPreviewProps {
  readonly jobId: string;
  /** The bridge; `window.throng.print` in the app. */
  readonly bridge?: PrintBridge;
}

/** Whether `settings` can be laid out: a page range, when chosen, must name pages. */
function rangeValid(settings: PrintSettings): boolean {
  return settings.pages.all || parsePageRanges(settings.pages.ranges) !== null;
}

/** A key's step through the pages: a page either way, or the first or last. */
const PAGE_KEYS: Record<string, number | 'first' | 'last'> = {
  ArrowRight: 1,
  ArrowDown: 1,
  PageDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageUp: -1,
  Home: 'first',
  End: 'last',
};

/** Whether `target` is a field that takes these keys itself. */
function takesKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable);
}

/** The margins drawing's longer side, in em: the page drawn at the paper's shape within it. */
const SHEET_LONG_EM = 7;

/**
 * 075 FR-068b (the maintainer, 2026-11-20: "When 'landscape' is selected, the example page for margins should switch
 * to landscape") — the drawn page in the paper's proportions, turned for the orientation, its longer side
 * {@link SHEET_LONG_EM}. Its shorter side stays wider than a margin box and taller than a side box for every paper
 * offered, so the page still fills its cell and the gap round it stays even.
 */
function sheetSize(settings: PrintSettings): CSSProperties {
  const { width, height } = paperSizeMm(settings.pageSize, settings.orientation);
  const long = Math.max(width, height);
  return {
    '--print-sheet-width': `${((width / long) * SHEET_LONG_EM).toFixed(3)}em`,
    '--print-sheet-height': `${((height / long) * SHEET_LONG_EM).toFixed(3)}em`,
  } as CSSProperties;
}

export function PrintPreview({ jobId, bridge = window.throng?.print }: PrintPreviewProps): ReactElement {
  const [job, setJob] = useState<PrintJobView | null>(null);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [laying, setLaying] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  // FR-068a — the printed page on screen, 1-based; kept across a settings change.
  const [page, setPage] = useState(1);
  const [drawn, setDrawn] = useState(false);
  const [shown, setShown] = useState<PrintSettings | null>(null);
  /** Known gap 1 — the page count, when every page the range names lies past the last; `null` otherwise. */
  const [pastEnd, setPastEnd] = useState<{ range: string; pageCount: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  // 2026-11-20 — each typed number's state; Print waits until every one is checked and valid.
  const [fields, setFields] = useState<Readonly<Record<string, FieldState>>>({});
  const [scaleCustom, setScaleCustom] = useState(false);
  const fieldState = useCallback(
    (id: string) =>
      (state: FieldState): void =>
        setFields((f) => (f[id] === state ? f : { ...f, [id]: state })),
    [],
  );
  const settingsRef = useRef<PrintSettings | null>(null);
  settingsRef.current = settings;
  const pageRef = useRef(1);
  pageRef.current = page;
  const pages = useRef<PrintPages | null>(null);
  const canvasHost = useRef<HTMLDivElement | null>(null);
  const drawSeq = useRef(0);
  /** The margins the pages on screen were laid out with, for the dashed guide (2026-11-20). */
  const laidOutMargins = useRef<PrintMargins | null>(null);
  const wheel = useRef({ gathered: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });

  /** Draw page `n` of `doc` off screen, and put it on screen once drawn — unless a later draw was asked for. */
  const drawPage = useCallback((doc: PrintPages, n: number): void => {
    const host = canvasHost.current;
    if (host === null) return;
    const seq = ++drawSeq.current;
    const rect = host.getBoundingClientRect();
    const box = { width: Math.max(1, rect.width - 2 * PAGE_MARGIN_PX), height: Math.max(1, rect.height - 2 * PAGE_MARGIN_PX) };
    const canvas = document.createElement('canvas');
    canvas.className = 'print-preview__page';
    canvas.setAttribute('aria-label', `Page ${n}`);
    doc.draw(n, canvas, box, window.devicePixelRatio || 1).then(
      (size) => {
        if (seq !== drawSeq.current) return;
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        // The paper, with the margins outlined in dashes where the printed content stops. The outline is the
        // window's, never the PDF's: it is not printed.
        const sheet = document.createElement('div');
        sheet.className = 'print-preview__sheet';
        sheet.append(canvas);
        const m = laidOutMargins.current;
        if (m !== null && size.widthMm > 0 && size.heightMm > 0) {
          const across = size.width / size.widthMm;
          const down = size.height / size.heightMm;
          const guide = document.createElement('div');
          guide.className = 'print-preview__margin-guide';
          guide.dataset.testid = 'print-margin-guide';
          guide.setAttribute('aria-hidden', 'true');
          guide.style.top = `${m.top * down}px`;
          guide.style.right = `${m.right * across}px`;
          guide.style.bottom = `${m.bottom * down}px`;
          guide.style.left = `${m.left * across}px`;
          sheet.append(guide);
        }
        host.replaceChildren(sheet);
        setDrawn(true);
      },
      (error: unknown) => {
        // A draw overtaken by a newer one, or by its layout being let go, is not a failure.
        if (seq !== drawSeq.current) return;
        logCaught('print-preview: draw a page', error);
        setNotice('The page could not be drawn.');
      },
    );
  }, []);

  useEffect(() => {
    let active = true;
    void bridge?.job(jobId).then((view) => {
      if (!active || view === null) return;
      setJob(view);
      setSettings(view.settings);
    });
    return () => {
      active = false;
    };
  }, [bridge, jobId]);

  // The laid-out pages go with the window.
  useEffect(
    () => () => {
      drawSeq.current += 1;
      pages.current?.destroy();
      pages.current = null;
    },
    [],
  );

  // Lay the pages out again once the controls have been still for a moment.
  useEffect(() => {
    if (settings === null || bridge === undefined) return;
    // A range that names no pages is not laid out, so nothing is being laid out — even if a change before it was.
    if (!rangeValid(settings)) {
      setLaying(false);
      return;
    }
    let active = true;
    setLaying(true);
    const timer = setTimeout(() => {
      void bridge
        .render(jobId, settings)
        .then(async (result) => {
          if (!active) return;
          if ('error' in result) {
            setLaying(false);
            setNotice(`The pages could not be laid out: ${result.error}`);
            setShown(null);
            return;
          }
          if ('outOfRange' in result) {
            // Said on the range box itself, as a malformed range is: no page to show, and nothing to print.
            setLaying(false);
            setShown(null);
            setPastEnd({ range: settings.pages.all ? '' : settings.pages.ranges, pageCount: result.pageCount });
            return;
          }
          setPastEnd(null);
          const doc = await openPrintPages(result.pdf);
          if (!active) {
            doc.destroy();
            return;
          }
          const previous = pages.current;
          pages.current = doc;
          laidOutMargins.current = marginsMm(settings);
          previous?.destroy();
          const n = Math.min(Math.max(1, pageRef.current), Math.max(1, doc.pageCount));
          setNotice(null);
          setPageCount(doc.pageCount);
          setPage(n);
          setShown(settings);
          setLaying(false);
          drawPage(doc, n);
        })
        .catch((error: unknown) => {
          if (!active) return;
          logCaught('print-preview: open the laid-out pages', error);
          setLaying(false);
          setShown(null);
          setNotice('The pages could not be shown.');
        });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridge, jobId, settings, drawPage]);

  // 2026-11-20 — a printer the OS finds (or loses) while the window is open shows up in the list. The chosen one is
  // kept while it is there; once it has gone, the first that is.
  useEffect(() => {
    const refresh = bridge?.printers;
    if (refresh === undefined) return;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void refresh(jobId)
        .then((printers) => {
          if (printers === null) return;
          setJob((j) => (j === null || JSON.stringify(j.printers) === JSON.stringify(printers) ? j : { ...j, printers }));
          setSettings((s) => {
            if (s === null || (s.printer !== null && printers.some((p) => p.name === s.printer))) return s;
            const next = printers[0]?.name ?? null;
            return next === s.printer ? s : { ...s, printer: next };
          });
        })
        .catch((error: unknown) => logCaught('print-preview: read the printers', error))
        .finally(() => {
          busy = false;
        });
    }, PRINTER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [bridge, jobId]);

  // A resized window fits the page to its new area.
  useEffect(() => {
    const host = canvasHost.current;
    if (host === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pages.current !== null) drawPage(pages.current, pageRef.current);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [drawPage]);

  const close = useCallback((): void => {
    const current = settingsRef.current;
    if (current !== null) void bridge?.close(jobId, current);
  }, [bridge, jobId]);

  const update = (change: Partial<PrintSettings>): void => setSettings((s) => (s === null ? s : { ...s, ...change }));

  const noPrinter = job !== null && job.printers.length === 0;
  const upToDate = settings !== null && shown !== null && JSON.stringify(settings) === JSON.stringify(shown);
  const anyInvalid = Object.values(fields).includes('invalid');
  /** Gap 1 — the past-the-end answer, while the range it was given for is still the one in the box. */
  const rangePastEnd = pastEnd !== null && settings !== null && !settings.pages.all && settings.pages.ranges === pastEnd.range ? pastEnd : null;
  const anyPending = Object.values(fields).includes('pending');
  const canPrint = !noPrinter && upToDate && !laying && !printing && !anyInvalid && !anyPending;
  const settled = upToDate && !laying && pageCount !== null;
  const canBack = settled && page > 1;
  const canForward = settled && pageCount !== null && page < pageCount;

  /** FR-068a — show page `n`, kept to the pages there are. Nothing is laid out again. */
  const goTo = (n: number): void => {
    const doc = pages.current;
    if (!settled || doc === null) return;
    const target = Math.min(Math.max(1, n), doc.pageCount);
    if (target === page) return;
    setPage(target);
    drawPage(doc, target);
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      const step = PAGE_KEYS[e.key];
      if (step === undefined || e.ctrlKey || e.altKey || e.metaKey || takesKeys(e.target)) return;
      e.preventDefault();
      const count = pages.current?.pageCount ?? 1;
      goToRef.current(step === 'first' ? 1 : step === 'last' ? count : pageRef.current + step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /** FR-068a — a page per wheel notch; a trackpad's small movements gather until they come to one. */
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    const w = wheel.current;
    w.gathered += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.gathered = 0;
    }, WHEEL_IDLE_MS);
    if (Math.abs(w.gathered) < WHEEL_STEP_PX) return;
    const step = Math.sign(w.gathered);
    w.gathered = 0;
    goTo(pageRef.current + step);
  };

  const print = (): void => {
    if (settings === null || bridge === undefined || !canPrint) return;
    const shown = pages.current;
    if (shown === null) return;
    setPrinting(true);
    // 2026-11-20 — the printer gets the pages shown, drawn: what prints is what the preview showed.
    void shown
      .sheet()
      .then((sheet) => bridge.print(jobId, settings, sheet))
      .then(
        (result) => {
          setPrinting(false);
          setNotice(result.ok ? null : `Printing failed: ${result.cause}`);
        },
        (error: unknown) => {
          setPrinting(false);
          setNotice(`Printing failed: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
  };

  const disabledReason = noPrinter
    ? 'No printer is available.'
    : anyInvalid
      ? 'Correct the settings outlined in red.'
      : !upToDate || laying || anyPending
        ? 'The pages are still being laid out.'
        : undefined;
  const scaleIsCustom = settings !== null && (scaleCustom || !(SCALE_CHOICES as readonly number[]).includes(settings.scale.percent));

  return (
    <div className="print-preview" data-testid="print-preview" style={{ '--print-paper': PRINT_PALETTE.editorBg } as CSSProperties}>
      <TitleBar identity={`Print Preview — ${job?.title ?? ''}`} closeOnly />
      <div className="print-preview__main">
        <form className="print-preview__controls" onSubmit={(e) => e.preventDefault()} aria-label="Print settings">
          {settings === null || job === null ? (
            <p className="print-preview__status">Loading…</p>
          ) : (
            <>
              <label className="print-preview__field">
                <span>Printer</span>
                {noPrinter ? (
                  <span className="print-preview__message" data-testid="print-no-printer">
                    No printer is available.
                  </span>
                ) : (
                  <select value={settings.printer ?? ''} onChange={(e) => update({ printer: e.target.value })} data-testid="print-printer">
                    {job.printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="print-preview__field">
                <span>Paper size</span>
                <select value={settings.pageSize} onChange={(e) => update({ pageSize: e.target.value as PrintSettings['pageSize'] })} data-testid="print-page-size">
                  {PRINT_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {paperSizeLabel(size, settings.orientation)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="print-preview__field">
                <span>Orientation</span>
                <select value={settings.orientation} onChange={(e) => update({ orientation: e.target.value as PrintSettings['orientation'] })} data-testid="print-orientation">
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label className="print-preview__field">
                <span>Margins</span>
                <select
                  value={settings.margins.preset}
                  onChange={(e) => update({ margins: { ...settings.margins, preset: e.target.value as PrintMarginPreset } })}
                  data-testid="print-margins"
                >
                  {(Object.keys(MARGIN_LABELS) as PrintMarginPreset[]).map((preset) => (
                    <option key={preset} value={preset}>
                      {MARGIN_LABELS[preset]}
                    </option>
                  ))}
                </select>
              </label>
              {settings.margins.preset === 'custom' && (
                // 2026-11-20 — drawn as the page: a box at each edge, in millimetres, round a white sheet.
                <div className="print-preview__margins-page" role="group" aria-label="Custom margins" data-testid="print-margins-page">
                  {EDGES.map((side) => (
                    <span key={side} className={`print-preview__margin-edge print-preview__margin-edge--${side}`} data-edge={side}>
                      <NumberField
                        value={settings.margins.custom[side]}
                        field={PRINT_FIELDS.margin}
                        label={`${side[0]!.toUpperCase()}${side.slice(1)} margin, mm`}
                        testId={`print-margin-${side}`}
                        onState={fieldState(`margin-${side}`)}
                        onCommit={(v) => update({ margins: { ...settings.margins, custom: { ...settings.margins.custom, [side]: v } } })}
                      />
                      <span className="print-preview__margin-unit" aria-hidden="true">
                        mm
                      </span>
                    </span>
                  ))}
                  <span className="print-preview__margins-sheet" aria-hidden="true" style={sheetSize(settings)} />
                </div>
              )}
              <label className="print-preview__field print-preview__field--inline">
                <input type="checkbox" checked={settings.scale.fitWidth} onChange={(e) => update({ scale: { ...settings.scale, fitWidth: e.target.checked } })} data-testid="print-fit-width" />
                <span>{job.fit === 'page' ? 'Fit to page' : 'Fit to page width'}</span>
              </label>
              {/* 075 FR-068e — one checkbox, both directions: a picture has one middle, and a pair of boxes would offer
                  half-centred layouts nobody asked for. It edits the setting for this job's kind. */}
              <label className="print-preview__field print-preview__field--inline">
                <input
                  type="checkbox"
                  checked={settings.centre[job.fit]}
                  onChange={(e) => update({ centre: { ...settings.centre, [job.fit]: e.target.checked } })}
                  data-testid="print-centre"
                />
                <span>Centre on page</span>
              </label>
              {!settings.scale.fitWidth && (
                <div className="print-preview__field">
                  <span id="print-scale-label">Scale</span>
                  <span className="print-preview__scale-row">
                    <select
                      aria-labelledby="print-scale-label"
                      value={scaleIsCustom ? 'custom' : String(settings.scale.percent)}
                      onChange={(e) => {
                        if (e.target.value === 'custom') {
                          setScaleCustom(true);
                          return;
                        }
                        setScaleCustom(false);
                        update({ scale: { ...settings.scale, percent: Number(e.target.value) } });
                      }}
                      data-testid="print-scale"
                    >
                      {SCALE_CHOICES.map((p) => (
                        <option key={p} value={String(p)}>
                          {p}%
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  {scaleIsCustom && (
                    <span className="print-preview__field print-preview__field--inline">
                      <NumberField
                        value={settings.scale.percent}
                        field={PRINT_FIELDS.scale}
                        label="Custom scale, percent"
                        testId="print-scale-custom"
                        onState={fieldState('scale')}
                        onCommit={(v) => update({ scale: { ...settings.scale, percent: v } })}
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  )}
                  </span>
                </div>
              )}
              <fieldset className="print-preview__pages">
                <legend>Pages</legend>
                <label className="print-preview__field print-preview__field--inline">
                  <input type="radio" name="pages" checked={settings.pages.all} onChange={() => update({ pages: { all: true } })} data-testid="print-pages-all" />
                  <span>All</span>
                </label>
                <label className="print-preview__field print-preview__field--inline">
                  <input type="radio" name="pages" checked={!settings.pages.all} onChange={() => update({ pages: { all: false, ranges: rangeText } })} data-testid="print-pages-range" />
                  <input
                    type="text"
                    placeholder="e.g. 1-3, 5"
                    aria-label="Page range"
                    value={rangeText}
                    onChange={(e) => {
                      setRangeText(e.target.value);
                      update({ pages: { all: false, ranges: e.target.value } });
                    }}
                    aria-invalid={!rangeValid(settings) || rangePastEnd !== null || undefined}
                    data-testid="print-pages-text"
                  />
                </label>
                {!rangeValid(settings) && <span className="print-preview__message">Enter pages as numbers and ranges, such as 1-3, 5.</span>}
                {rangeValid(settings) && rangePastEnd !== null && (
                  <span className="print-preview__message">
                    This document has {formatGrouped(rangePastEnd.pageCount)} page{rangePastEnd.pageCount === 1 ? '' : 's'}.
                  </span>
                )}
              </fieldset>
              <label className="print-preview__field">
                <span>Copies</span>
                <NumberField
                  value={settings.copies}
                  field={PRINT_FIELDS.copies}
                  label="Copies"
                  testId="print-copies"
                  onState={fieldState('copies')}
                  onCommit={(v) => update({ copies: v })}
                />
              </label>
              {notice !== null && (
                <div className="print-preview__notice" role="alert" data-testid="print-notice">
                  {notice}
                </div>
              )}
              <div className="print-preview__actions">
                <button type="button" className="print-preview__print" onClick={print} disabled={!canPrint} title={disabledReason} data-testid="print-print">
                  <Icon token="print" />
                  <span>Print</span>
                </button>
                <button type="button" onClick={close} data-testid="print-close">
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
        <div className="print-preview__pages-area">
          <div className="print-preview__page-bar">
            <IconButton token="pagePrevious" title="Previous page" onClick={() => goTo(page - 1)} disabled={!canBack} testId="print-page-back" />
            <div className="print-preview__status" aria-live="polite" data-testid="print-status">
              {laying ? 'Laying out pages…' : pageCount !== null ? `Page ${formatGrouped(page)} of ${formatGrouped(pageCount)}` : ''}
            </div>
            <IconButton token="pageNext" title="Next page" onClick={() => goTo(page + 1)} disabled={!canForward} testId="print-page-forward" />
          </div>
          <div
            className="print-preview__page-view"
            data-testid="print-page-view"
            aria-busy={laying || !drawn}
            onWheel={onWheel}
          >
            <div className="print-preview__canvas-host" ref={canvasHost} />
            {!drawn && (
              <div className="print-preview__spinner">
                <Spinner label="Laying out pages" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The window's root: the active theme, then the app. */
export function PrintPreviewApp({ jobId }: { jobId: string }): ReactElement {
  return (
    <ConfigProvider>
      <Themed jobId={jobId} />
    </ConfigProvider>
  );
}

function Themed({ jobId }: { jobId: string }): ReactElement {
  const theme = useActiveTheme();
  return (
    <ThemeProvider theme={theme}>
      <PrintPreview jobId={jobId} />
    </ThemeProvider>
  );
}
