import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  matchFamilies,
  parseFontStack,
  serializeFontStack,
  type FieldDescriptor,
} from '@throng/core';
import { SettingControl } from './form-controls.js';
import { IconButton } from '../common/icon-button.js';

/**
 * Theme token pickers (feature 007, US4 — FR-038/038a/038b). A colour picker for
 * colour tokens and a partial-match font-family typeahead for font tokens; number
 * / font-size / enum reuse the generic form controls. Icon tokens are handled by
 * the icon section, not here.
 */

/** A small curated fallback list when the OS font cache isn't populated yet (FR-038a). */
const CURATED_FONTS = [
  'Segoe UI',
  'Arial',
  'Calibri',
  'Consolas',
  'Courier New',
  'Georgia',
  'Tahoma',
  'Times New Roman',
  'Verdana',
  'Cascadia Code',
  'Cascadia Mono',
];

import { ColourField } from '../common/colour-picker.js';

const testId = (key: string): string => `control-${key}`;

/**
 * 018 / US4 — the colour control.
 *
 * This WAS an `<input type="color">`, whose popup is the OPERATING SYSTEM'S OWN COLOUR DIALOG: a
 * light-grey panel in system fonts, in the middle of a fully-themed dark application. No stylesheet,
 * attribute or flag can reach it (the CSS that used to sit beside this said as much, and named issue
 * #64). The only remedy is to stop using the native control.
 *
 * It also had NO VALIDATION AT ALL: both the swatch and the hex field committed on every `change`,
 * so typing `zzz` wrote the string `zzz` into the theme file on disk and the token stopped
 * rendering. The specification called FR-026 a *preserved* behaviour. It is a bug fix.
 *
 * Both identifiers are kept — `control-<key>` and `control-<key>-hex` — because the themes suites
 * drive the hex field by name.
 */
function ColourPicker({
  descriptor,
  value,
  onCommit,
}: {
  descriptor: FieldDescriptor;
  value: unknown;
  onCommit: (v: unknown) => void;
}): ReactElement {
  const hex = typeof value === 'string' ? value : '';
  return (
    <ColourField
      value={hex}
      testId={testId(descriptor.key)}
      onCommit={onCommit}
      // Only a token that DECLARES itself clearable may be emptied — the registry is the authority on
      // which absences mean something, and the picker is not.
      clearable={descriptor.clearable === true}
    />
  );
}

/**
 * The font-family control (H4, FR-038b): a multi-select **pill editor**. The
 * theme stores a comma-separated CSS stack; each family is shown as a deletable
 * pill (ordered), clicking the input opens a typeahead dropdown of the curated /
 * installed families, selecting appends a pill, and the ordered pills serialise
 * back to the stack. Free-typed families are accepted (Enter to add, FR-038a).
 *
 * Pills are held as optimistic local state so rapid picks accumulate correctly
 * even before each write round-trips through the live-reload path; the state
 * resyncs from `value` on any *external* change (theme switch / reset / JSON
 * edit) but ignores the echo of our own last write.
 */
function FontFamilyPills({
  descriptor,
  value,
  families,
  onCommit,
}: {
  descriptor: FieldDescriptor;
  value: unknown;
  families: readonly string[];
  onCommit: (v: unknown) => void;
}): ReactElement {
  const strValue = typeof value === 'string' ? value : '';
  const [pills, setPills] = useState<string[]>(() => parseFontStack(strValue));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  /**
   * FR-013 — flip like every other floating surface.
   *
   * The typeahead is carved out of "must BE the shared menu" on the record: it is a combobox, a
   * filtered value picker, not a list of actions. It is NOT carved out of behaving like a floating
   * surface. It opened straight downward with no measurement at all, so on the last row of a short
   * window it opened off the bottom of the screen — the list you need is the list you cannot see.
   *
   * Its HEIGHT was already clamped (`max-height` + scroll). This is the other half.
   */
  useLayoutEffect(() => {
    if (!open) {
      setFlipUp(false);
      return;
    }
    const el = listRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Measure the UNFLIPPED position, and flip only when there is more room above than below —
    // flipping into an even smaller gap would trade one clipped list for another.
    setFlipUp(r.bottom > window.innerHeight && r.top > window.innerHeight - r.bottom);
  }, [open, query]);
  const ref = useRef<HTMLDivElement>(null);
  const lastCommitted = useRef<string | null>(null);

  // Resync from an external change; ignore the round-trip echo of our own write.
  useEffect(() => {
    if (strValue === lastCommitted.current) return;
    lastCommitted.current = null;
    setPills(parseFontStack(strValue));
  }, [strValue]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const matches = useMemo(
    () =>
      matchFamilies(query, families)
        .filter((f) => !pills.some((p) => p.toLowerCase() === f.toLowerCase()))
        .slice(0, 12),
    [query, families, pills],
  );

  const commit = (next: string[]): void => {
    setPills(next);
    const serialised = serializeFontStack(next);
    lastCommitted.current = serialised;
    onCommit(serialised);
  };

  const addFamily = (raw: string): void => {
    const name = raw.trim();
    setQuery('');
    if (!name || pills.some((p) => p.toLowerCase() === name.toLowerCase())) return;
    commit([...pills, name]);
  };

  const removeAt = (i: number): void => commit(pills.filter((_, idx) => idx !== i));

  return (
    <div className="ctl ctl--font-pills" ref={ref}>
      <div className="ctl__pills">
        {pills.map((p, i) => (
          <span className="ctl__pill" key={`${p}-${i}`} data-testid={`${testId(descriptor.key)}-pill-${i}`}>
            <span className="ctl__pill-label" style={{ fontFamily: p }}>
              {p}
            </span>
            <IconButton
              token="destroy"
              className="ctl__pill-x"
              testId={`${testId(descriptor.key)}-remove-${i}`}
              title={`Remove ${p}`}
              onClick={() => removeAt(i)}
            />
          </span>
        ))}
        <input
          type="text"
          className="ctl__input ctl__pill-input"
          data-testid={testId(descriptor.key)}
          value={query}
          placeholder={pills.length ? 'Add font…' : 'Add a font family…'}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addFamily(query);
            }
          }}
        />
      </div>
      {open && matches.length > 0 ? (
        <div
          ref={listRef}
          className={`ctl__font-list${flipUp ? ' ctl__font-list--up' : ''}`}
          data-testid={`${testId(descriptor.key)}-list`}
        >
          {matches.map((f) => (
            <button
              type="button"
              key={f}
              className="ctl__font-item"
              data-testid={`${testId(descriptor.key)}-option-${f}`}
              style={{ fontFamily: f }}
              onMouseDown={(e) => {
                e.preventDefault();
                addFamily(f);
                setOpen(true);
              }}
            >
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface ThemeTokenControlProps {
  descriptor: FieldDescriptor;
  value: unknown;
  fonts: readonly string[];
  onCommit: (value: unknown) => void;
}

/** Render the control for a theme token, dispatching to the type-matched picker. */
export function ThemeTokenControl(props: ThemeTokenControlProps): ReactElement {
  switch (props.descriptor.control) {
    case 'colour':
      return <ColourPicker {...props} />;
    case 'font-family':
      return (
        <FontFamilyPills
          descriptor={props.descriptor}
          value={props.value}
          families={props.fonts.length ? props.fonts : CURATED_FONTS}
          onCommit={props.onCommit}
        />
      );
    default:
      // number / font-size / enum reuse the generic controls.
      return (
        <SettingControl descriptor={props.descriptor} value={props.value} onCommit={props.onCommit} />
      );
  }
}

export { CURATED_FONTS };
