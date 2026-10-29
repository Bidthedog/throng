import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ENCODING_CHOICES, encodingLabel, type EncodingId } from '@throng/core';
import type { EncodingPickerMode } from './picker-request.js';
import { CODE_PAGES_LABEL } from './content-menu.js';

/**
 * The encoding picker (059 FR-024, FR-027), modelled on the language picker and anchored to the same strip.
 *
 * It serves two commands. *Change Encoding* (FR-055, FR-058 — the command's picker; the indicator's menu is
 * the same list) lists every format — UTF-8 with and without a BOM, UTF-16 LE and BE (each with a BOM), then
 * the Windows code pages named with their script (FR-069) — and changes the document, writing nothing.
 * *Reopen with Encoding* lists each encoding once: whether there is a BOM is read from the file, not chosen.
 * The document's current format is marked, and choosing applies at once — there is no OK button to forget.
 *
 * A dozen rows need no filter, so the list itself takes focus: it is ONE tab stop with a roving tabindex, the
 * arrows move within it, Home / End jump to the ends, Enter or a click chooses and Escape closes. The group
 * headings, "Unicode" and "Windows Code Pages" (FR-070), are not rows: the roving index counts buttons only.
 */
export interface EncodingPickerProps {
  panelId: string;
  mode: EncodingPickerMode;
  current: { encoding: EncodingId; hasBom: boolean };
  onChoose: (choice: { encoding: EncodingId; hasBom: boolean }) => void;
  onClose: () => void;
}

interface Row {
  encoding: EncodingId;
  hasBom: boolean;
  label: string;
  /** FR-069: the Unicode encodings, then the code pages — a divider is drawn where it changes. */
  group: 'unicode' | 'codepage';
}

/** Reopen chooses an encoding only: one row per encoding, in the change list's order. */
const REOPEN_ROWS: readonly Row[] = ENCODING_CHOICES.filter(
  (c, i) => ENCODING_CHOICES.findIndex((d) => d.encoding === c.encoding) === i,
).map((c) => ({
  encoding: c.encoding,
  hasBom: false,
  // A code page keeps its script; a Unicode encoding drops the "with BOM" the change list names.
  label: c.group === 'codepage' ? c.label : encodingLabel(c.encoding, false),
  group: c.group,
}));

const GROUP_HEADING: Record<Row['group'], string> = { unicode: 'Unicode', codepage: CODE_PAGES_LABEL };

const TITLE: Record<EncodingPickerMode, string> = {
  reopen: 'Reopen with Encoding',
  change: 'Change Encoding',
};

export function EncodingPicker({ panelId, mode, current, onChoose, onClose }: EncodingPickerProps): ReactElement {
  const rows: readonly Row[] = mode === 'change' ? ENCODING_CHOICES : REOPEN_ROWS;
  const isCurrent = (r: Row): boolean =>
    r.encoding === current.encoding && (mode === 'reopen' || r.hasBom === current.hasBom);
  const [active, setActive] = useState(() => Math.max(0, rows.findIndex(isCurrent)));
  const listRef = useRef<HTMLUListElement>(null);

  const focusRow = (i: number): void => {
    const clamped = Math.max(0, Math.min(i, rows.length - 1));
    setActive(clamped);
    listRef.current?.querySelectorAll<HTMLElement>('.language-picker__item')[clamped]?.focus();
  };

  // Take the keyboard on open, at the current format — the one a user most likely wants to move FROM.
  useEffect(() => {
    focusRow(active);
    // Once, on open: re-running on `active` would steal focus back on every arrow key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      // The language picker's surface and rows, so the strip's two pickers read as one family.
      className="language-picker encoding-picker"
      role="dialog"
      aria-label={TITLE[mode]}
      data-testid={`encoding-picker-${panelId}`}
      data-mode={mode}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="encoding-picker__title">{TITLE[mode]}</div>
      <ul
        className="language-picker__list"
        role="listbox"
        aria-label={TITLE[mode]}
        ref={listRef}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusRow(active + 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusRow(active - 1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            focusRow(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            focusRow(rows.length - 1);
          }
        }}
      >
        {rows.map((row, i) => [
          // FR-070: a heading opens each group. Not an option, so the roving index never lands on it.
          rows[i - 1]?.group !== row.group ? (
            <li key={`head-${row.group}`} className="encoding-picker__heading" role="presentation">
              {GROUP_HEADING[row.group]}
            </li>
          ) : null,
          <li key={`${row.encoding}:${row.hasBom}`}>
            <button
              type="button"
              role="option"
              aria-selected={isCurrent(row)}
              tabIndex={i === active ? 0 : -1}
              className={`language-picker__item${isCurrent(row) ? ' language-picker__item--current' : ''}${
                i === active ? ' language-picker__item--active' : ''
              }`}
              data-testid={`encoding-option-${row.encoding}${row.hasBom ? '-bom' : ''}`}
              onFocus={() => setActive(i)}
              onClick={() => onChoose({ encoding: row.encoding, hasBom: row.hasBom })}
            >
              {row.label}
            </button>
          </li>,
        ])}
      </ul>
    </div>
  );
}
