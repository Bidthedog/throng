/**
 * The Print Preview window's app (075 FR-064, FR-068 – FR-071, FR-080, FR-081, research R11).
 *
 * Controls on the left, pages on the right. The pages are not drawn here: main lays the document out as a PDF
 * with the settings shown and places Chromium's PDF view over the page area, whose bounds this app reports. A
 * change to any control lays the pages out again, debounced, with progress shown while it runs (SC-008). Print
 * prints with exactly the settings the pages on screen were laid out with, with no OS dialog (Q4); a failure is
 * one inline notice, and pressing Print again retries. Close, Escape and the title bar close all save the
 * settings, page range excepted.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  COPIES_MAX,
  MARGIN_MAX_MM,
  PRINT_PAGE_SIZES,
  SCALE_MAX,
  SCALE_MIN,
  formatGrouped,
  parsePageRanges,
  type PrintJobView,
  type PrintMarginPreset,
  type PrintSettings,
} from '@throng/core';
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { Icon } from '../common/icon.js';
import './print-preview.css';

/** How long a control must be still before the pages are laid out again. */
export const RENDER_DEBOUNCE_MS = 300;

type PrintBridge = NonNullable<NonNullable<Window['throng']>['print']>;

const MARGIN_LABELS: Record<PrintMarginPreset, string> = { default: 'Default', minimum: 'Minimum', none: 'None', custom: 'Custom' };

export interface PrintPreviewProps {
  readonly jobId: string;
  /** The bridge; `window.throng.print` in the app. */
  readonly bridge?: PrintBridge;
}

/** Whether `settings` can be laid out: a page range, when chosen, must name pages. */
function rangeValid(settings: PrintSettings): boolean {
  return settings.pages.all || parsePageRanges(settings.pages.ranges) !== null;
}

export function PrintPreview({ jobId, bridge = window.throng?.print }: PrintPreviewProps): ReactElement {
  const [job, setJob] = useState<PrintJobView | null>(null);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [laying, setLaying] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [shown, setShown] = useState<PrintSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const pageArea = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<PrintSettings | null>(null);
  settingsRef.current = settings;

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
      void bridge.render(jobId, settings).then((result) => {
        if (!active) return;
        setLaying(false);
        if ('error' in result) {
          setNotice(`The pages could not be laid out: ${result.error}`);
          setShown(null);
          return;
        }
        setNotice(null);
        setPageCount(result.pageCount);
        setShown(settings);
      });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridge, jobId, settings]);

  // The page area's bounds, for main to place the pages over.
  useLayoutEffect(() => {
    const el = pageArea.current;
    if (el === null || bridge === undefined) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      void bridge.setPageArea(jobId, { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bridge, jobId, job]);

  const close = useCallback((): void => {
    const current = settingsRef.current;
    if (current !== null) void bridge?.close(jobId, current);
  }, [bridge, jobId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const update = (change: Partial<PrintSettings>): void => setSettings((s) => (s === null ? s : { ...s, ...change }));

  const noPrinter = job !== null && job.printers.length === 0;
  const upToDate = settings !== null && shown !== null && JSON.stringify(settings) === JSON.stringify(shown);
  const canPrint = !noPrinter && upToDate && !laying && !printing;

  const print = (): void => {
    if (settings === null || bridge === undefined || !canPrint) return;
    setPrinting(true);
    void bridge.print(jobId, settings).then((result) => {
      setPrinting(false);
      setNotice(result.ok ? null : `Printing failed: ${result.cause}`);
    });
  };

  const disabledReason = noPrinter
    ? 'No printer is available.'
    : !upToDate || laying
      ? 'The pages are still being laid out.'
      : undefined;

  return (
    <div className="print-preview" data-testid="print-preview">
      <TitleBar identity={`Print Preview — ${job?.title ?? ''}`} showMinimise={false} />
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
                      {size}
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
                <fieldset className="print-preview__margins">
                  <legend>Custom margins (mm)</legend>
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <label key={side} className="print-preview__field print-preview__field--inline">
                      <span>{side[0]!.toUpperCase() + side.slice(1)}</span>
                      <input
                        type="number"
                        min={0}
                        max={MARGIN_MAX_MM}
                        value={settings.margins.custom[side]}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          update({ margins: { ...settings.margins, custom: { ...settings.margins.custom, [side]: Math.min(MARGIN_MAX_MM, Math.max(0, v)) } } });
                        }}
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="print-preview__field print-preview__field--inline">
                <input type="checkbox" checked={settings.scale.fitWidth} onChange={(e) => update({ scale: { ...settings.scale, fitWidth: e.target.checked } })} data-testid="print-fit-width" />
                <span>{job.fit === 'page' ? 'Fit to page' : 'Fit to page width'}</span>
              </label>
              {!settings.scale.fitWidth && (
                <label className="print-preview__field">
                  <span>Scale (%)</span>
                  <input
                    type="number"
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    value={settings.scale.percent}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) update({ scale: { ...settings.scale, percent: Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v))) } });
                    }}
                    data-testid="print-scale"
                  />
                </label>
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
                    aria-invalid={!rangeValid(settings) || undefined}
                    data-testid="print-pages-text"
                  />
                </label>
                {!rangeValid(settings) && <span className="print-preview__message">Enter pages as numbers and ranges, such as 1-3, 5.</span>}
              </fieldset>
              <label className="print-preview__field">
                <span>Copies</span>
                <input
                  type="number"
                  min={1}
                  max={COPIES_MAX}
                  value={settings.copies}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (Number.isFinite(v)) update({ copies: Math.min(COPIES_MAX, Math.max(1, v)) });
                  }}
                  data-testid="print-copies"
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
          <div className="print-preview__status" aria-live="polite" data-testid="print-status">
            {laying ? 'Laying out pages…' : pageCount !== null ? `${formatGrouped(pageCount)} ${pageCount === 1 ? 'page' : 'pages'}` : ''}
          </div>
          <div className="print-preview__page-view" ref={pageArea} data-testid="print-page-area" />
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
