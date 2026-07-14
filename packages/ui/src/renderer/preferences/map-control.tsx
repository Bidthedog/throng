import { useState, type ReactElement } from 'react';
import { LANGUAGES, languageName, type FieldDescriptor, type MapColumn } from '@throng/core';
import { IconButton } from '../common/icon-button.js';

/**
 * The keyed-table control (016, F5/FR-022) — a settings value that is a MAP.
 *
 * Two settings need it: `editor.indentByLanguage` (language → indent profile) and
 * `editor.languageByExtension` (extension → language). Both are open-ended: the user adds rows the
 * app has never heard of, so the rows are DATA, not fields of the schema, and the control is
 * generic over whatever columns the descriptor declares.
 *
 * The add/remove affordances are ACTION CONTROLS, so they are theme icon tokens with hover titles —
 * never text labels, never inline SVG, never a hardcoded colour (constitution, non-negotiable —
 * T106). They go through {@link IconButton} exactly as every other action control in the app does.
 */

export interface MapControlProps {
  descriptor: FieldDescriptor;
  value: unknown;
  /** Dynamic options for a column whose values are not static (the language list). */
  options?: readonly (string | number)[];
  onCommit: (value: unknown) => void;
}

type Row = Record<string, unknown>;
type MapValue = Record<string, unknown>;

const asMap = (value: unknown): MapValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as MapValue) : {};

/**
 * A key must be unique, and non-empty. An extension key must also LOOK like an extension.
 *
 * Returned as a message rather than a boolean, because "invalid" with no reason is a dead end for a
 * user who cannot see what the rule is.
 */
export function validateKey(
  key: string,
  existing: readonly string[],
  descriptor: FieldDescriptor,
): string | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return descriptor.keyKind === 'language' ? 'Choose a language.' : 'A key is required.';
  }
  if (existing.includes(trimmed)) {
    const shown = descriptor.keyKind === 'language' ? languageName(trimmed) : trimmed;
    return `“${shown}” is already mapped.`;
  }
  if (descriptor.key.endsWith('ByExtension') && !/^\.[A-Za-z0-9_+-]+$/.test(trimmed)) {
    return 'An extension must start with a dot, e.g. “.foo”.';
  }
  return null;
}

/** How a KEY is shown to the user: a language by its NAME, never by its internal id. */
function keyText(key: string, descriptor: FieldDescriptor): string {
  return descriptor.keyKind === 'language' ? languageName(key) : key;
}

export function MapControl({ descriptor, value, options, onCommit }: MapControlProps): ReactElement {
  const map = asMap(value);
  const columns: readonly MapColumn[] = descriptor.columns ?? [];
  // Sorted by what the user SEES, not by the internal id — otherwise a table of language names comes
  // out in the order of ids nobody is looking at (`cpp` before `csharp` before `c`… ).
  const keys = Object.keys(map).sort((a, b) =>
    keyText(a, descriptor).localeCompare(keyText(b, descriptor)),
  );
  /** The languages not already in the table — what the picker may still offer. */
  const unmapped = LANGUAGES.filter((l) => !keys.includes(l.id)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (next: MapValue): void => onCommit(next);

  const addRow = (): void => {
    const problem = validateKey(newKey, keys, descriptor);
    if (problem) {
      setError(problem);
      return;
    }
    const key = newKey.trim();
    // A new row starts from the FIRST column's default rather than empty, so it is immediately a
    // valid entry — an empty row would be dropped by the tolerant parser on the next save, and the
    // user would watch their new row vanish.
    const seed: unknown = columns.length === 1 && !columns[0].key ? (options?.[0] ?? '') : defaultRow(columns);
    commit({ ...map, [key]: seed });
    setNewKey('');
    setError(null);
  };

  const removeRow = (key: string): void => {
    const next = { ...map };
    delete next[key];
    commit(next);
  };

  const setCell = (key: string, column: MapColumn, cell: unknown): void => {
    if (!column.key) {
      commit({ ...map, [key]: cell }); // a scalar-valued map: the value IS the cell
      return;
    }
    const row = { ...(map[key] as Row) };
    row[column.key] = cell;
    commit({ ...map, [key]: row });
  };

  return (
    <div
      className={`map-control ${descriptor.keyKind === 'language' ? 'map-control--language' : 'map-control--text'}`}
      data-testid={`control-${descriptor.key}`}
    >
      <table className="map-control-table">
        <thead>
          <tr>
            <th>{descriptor.keyLabel ?? 'Key'}</th>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} data-testid={`map-row-${descriptor.key}-${key}`}>
              <td className="map-control-key">{keyText(key, descriptor)}</td>
              {columns.map((column) => (
                <td key={column.label}>
                  <MapCell
                    column={column}
                    options={options}
                    value={column.key ? (map[key] as Row)?.[column.key] : map[key]}
                    onCommit={(cell) => setCell(key, column, cell)}
                    testId={`map-cell-${descriptor.key}-${key}-${column.key ?? 'value'}`}
                  />
                </td>
              ))}
              <td>
                <IconButton
                  token="destroy"
                  title={`Remove ${key}`}
                  onClick={() => removeRow(key)}
                  testId={`map-remove-${descriptor.key}-${key}`}
                />
              </td>
            </tr>
          ))}
          {keys.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className="map-control-empty">
                No entries.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="map-control-add">
        {descriptor.keyKind === 'language' ? (
          // A PICKER, not a text box. The key here is a language, and the set of languages is known
          // and closed — asking the user to type `csharp` from memory into a free-text field that
          // accepts anything is asking them to guess an internal identifier.
          <select
            className="ctl--select map-control-select"
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setError(null);
            }}
            data-testid={`map-new-key-${descriptor.key}`}
            aria-label="Language to add"
          >
            <option value="">Choose a language…</option>
            {unmapped.map((language) => (
              <option key={language.id} value={language.id}>
                {language.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="ctl__input map-control-text"
            value={newKey}
            placeholder=".foo"
            onChange={(e) => {
              setNewKey(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRow();
            }}
            data-testid={`map-new-key-${descriptor.key}`}
            aria-label="New key"
          />
        )}
        <IconButton
          token="add"
          title="Add entry"
          onClick={addRow}
          testId={`map-add-${descriptor.key}`}
        />
      </div>
      {error ? (
        <div className="map-control-error" role="alert" data-testid={`map-error-${descriptor.key}`}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** A new row's value, built from the columns' own constraints. */
function defaultRow(columns: readonly MapColumn[]): Row {
  const row: Row = {};
  for (const column of columns) {
    if (!column.key) continue;
    if (column.control === 'number') row[column.key] = column.min ?? 1;
    else if (column.allowedValues?.length) row[column.key] = column.allowedValues[0];
    else row[column.key] = '';
  }
  return row;
}

interface MapCellProps {
  column: MapColumn;
  value: unknown;
  options?: readonly (string | number)[];
  onCommit: (value: unknown) => void;
  testId: string;
}

function MapCell({ column, value, options, onCommit, testId }: MapCellProps): ReactElement {
  const choices = column.allowedValues ?? options ?? [];
  // A language-valued cell shows the language's NAME while still storing its id.
  const isLanguage = column.label === 'Language' && !column.allowedValues;

  if (column.control === 'number') {
    return (
      <input
        type="number"
        className="ctl__input map-control-number"
        value={typeof value === 'number' ? value : ''}
        min={column.min}
        max={column.max}
        onChange={(e) => {
          const next = Number(e.target.value);
          // Refuse an out-of-range value rather than writing it: the tolerant parser would drop it
          // on the next load and the user's setting would silently revert (FR-017).
          if (!Number.isFinite(next)) return;
          if (column.min !== undefined && next < column.min) return;
          if (column.max !== undefined && next > column.max) return;
          onCommit(next);
        }}
        data-testid={testId}
      />
    );
  }

  return (
    <select
      className="ctl--select map-control-select"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onCommit(e.target.value)}
      data-testid={testId}
    >
      {choices.map((choice) => (
        <option key={String(choice)} value={String(choice)}>
          {isLanguage ? languageName(String(choice)) : String(choice)}
        </option>
      ))}
    </select>
  );
}
