import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  LANGUAGES,
  checkFlavourRecord,
  languageName,
  type FieldDescriptor,
  type MapColumn,
} from '@throng/core';
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
 *
 * ONE component, TWO modes (019, FR-020/C9). A `records` value is an ARRAY of records identified by
 * a declared `idKey` rather than a map keyed by a string — `terminals.flavours`. Everything else
 * about it is this control's job already: rows that are DATA, columns the descriptor declares, a
 * refusal that states its reason. So it is a mode here, never a second table:
 *
 *   • order is PRESERVED, never sorted (C11) — it is the Flavour dropdown's order, and
 *     `mergeFlavours` is first-wins, so which row is first is a fact the user can see
 *   • the id is rendered as text and is NOT editable (C13) — it keys `terminals.defaultParams`, so
 *     renaming in place would silently orphan the parameters keyed to it. Delete and re-add
 *   • rows are keyed by INDEX, not by id (C17): a file-authored duplicate id is reachable (the JSON
 *     tab ships, and `parseTerminals` does not dedupe), and both rows must render
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

export function MapControl(props: MapControlProps): ReactElement {
  // The mode is DECLARED, never inferred from the value (FR-018). The bug this replaces did infer
  // it: an empty flavours array rendered as a string-array editor, and one entry later as a JSON
  // textarea, because `[].every(…)` is vacuously true.
  return props.descriptor.control === 'records' ? (
    <RecordsControl {...props} />
  ) : (
    <KeyedMapControl {...props} />
  );
}

function KeyedMapControl({
  descriptor,
  value,
  options,
  onCommit,
}: MapControlProps): ReactElement {
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

/** The rows of a `records` value — anything that is not a record is not a row. */
const asRecords = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((r): r is Row => r !== null && typeof r === 'object') : [];

/**
 * How a row is ADDRESSED (C17): its id, or `${id}-${index}` for a row claiming an id an earlier row
 * already claimed.
 *
 * The suffix exists solely for a file-authored duplicate. An id-derived test id would otherwise put
 * two elements behind one locator — a Playwright strict-mode violation, which is undefined
 * behaviour wearing a locator, and it would make the duplicate case untestable. First-wins for the
 * un-suffixed name follows `mergeFlavours`'s own precedent.
 */
function rowKeysOf(records: readonly Row[], idKey: string): string[] {
  const claimed = new Set<string>();
  return records.map((record, index) => {
    const id = String(record[idKey] ?? '');
    if (claimed.has(id)) return `${id}-${index}`;
    claimed.add(id);
    return id;
  });
}

/** A row the user has STARTED but that cannot be written yet — see {@link RecordsControl}. */
type Draft = Row;

/**
 * An array of records, one row per record (019, FR-018/FR-019 — `terminals.flavours`).
 *
 * **Why a row can exist here before it exists in the settings file.** The tolerant parser DROPS a
 * flavour with no executable, so committing a half-filled row would write it out, have it parsed
 * away on the way back in, and the user would watch the row they just added vanish — which is #67's
 * own defect (an Add button appending a value the parser then swallowed). So an incomplete row is
 * held HERE, visible and flagged, and is committed the moment it is a flavour. Nothing invalid is
 * ever written.
 */
function RecordsControl({ descriptor, value, onCommit }: MapControlProps): ReactElement {
  const records = asRecords(value);
  const columns: readonly MapColumn[] = descriptor.columns ?? [];
  const idKey = descriptor.idKey ?? 'id';
  const noun = descriptor.itemNoun ?? 'record';

  const [newId, setNewId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const committedIds = records.map((r) => String(r[idKey] ?? ''));
  // A draft whose id has arrived in the settings document is no longer a draft — it is the row.
  const pending = drafts.filter((d) => !committedIds.includes(String(d[idKey] ?? '')));
  /**
   * Retire a CONFIRMED draft — after the render that stopped showing it, never before.
   *
   * `pending` already hides a draft the moment `records` contains it, so this only drops the state
   * that is no longer read; the rendered rows do not move, which is the entire point of doing it
   * here. Dropping it in the commit handler instead is what unmounted a row mid-keystroke: `records`
   * is a PROP and cannot refresh until the IPC write resolves, so a handler that removed the draft
   * AND committed left the very next render with neither — the row, and the focused `<input>` inside
   * it, gone.
   *
   * It cannot simply be left in `drafts` either: `pending` resurrects any draft whose id is not in
   * `records`, so a stale one would come back as a ghost row the moment the user deleted the flavour
   * it became.
   */
  // No dependency list ON PURPOSE: this reconciles against whatever `records` currently says, and a
  // draft is confirmed by a write from this window, by the JSON tab and by the file watcher alike.
  // It cannot chain: the updater returns the SAME array when there is nothing to retire, and React
  // bails out of an identical state value, so the common case is not a re-render at all.
  // (`NotificationProvider.clear` keeps its array identity for the same reason.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDrafts((cur) => {
      const next = cur.filter((d) => !committedIds.includes(String(d[idKey] ?? '')));
      return next.length === cur.length ? cur : next;
    });
  });
  // ORDER IS THE FILE'S (C11): the rows are never sorted. Drafts sit after them, in the order they
  // were added — which is where they will land when they commit.
  const rows = [...records, ...pending];
  const rowKeys = rowKeysOf(rows, idKey);

  /** What is wrong with a row, judged against the rows BEFORE it — so first-wins is what shows. */
  const problemOf = (index: number): string | null =>
    checkFlavourRecord(rows[index], rows.slice(0, index).map((r) => String(r[idKey] ?? '')))
      ?.message ?? null;

  const addRow = (): void => {
    const draft: Draft = { [idKey]: newId.trim(), label: '', file: '', args: [], defaultParams: '' };
    const problem = checkFlavourRecord(draft, rows.map((r) => String(r[idKey] ?? '')));
    // An ID problem refuses the row outright: an unnamed or duplicate id cannot even be addressed,
    // and a second row claiming one id has no defined winner. Anything else the row can be created
    // WITH — the message says what it still needs, which is guidance rather than a refusal.
    if (problem?.field === 'id') {
      setError(problem.message);
      return;
    }
    setDrafts([...pending, draft]);
    setNewId('');
    setError(problem?.message ?? null);
  };

  const removeRow = (index: number): void => {
    if (index < records.length) {
      commitRows(records.filter((_, i) => i !== index));
      return;
    }
    setDrafts(pending.filter((_, i) => i !== index - records.length));
  };

  /** Commit `[...records]` — an ARRAY, never an object. Feeding a map back would destroy the file. */
  const commitRows = (next: Row[]): void => onCommit(next);

  const setCell = (index: number, column: MapColumn, cell: unknown): void => {
    if (!column.key) return;
    const next = { ...rows[index], [column.key]: cell };
    if (index < records.length) {
      const list = [...records];
      list[index] = next;
      commitRows(list);
      return;
    }
    const draftIndex = index - records.length;
    const list = [...pending];
    list[draftIndex] = next;
    setDrafts(list);
    // A draft is written the moment it IS a flavour, and not before — but it is not DROPPED here.
    //
    // The draft is retired by CONFIRMATION (see the effect above), when the row it became arrives
    // back in `records`. Two defects follow from dropping it at commit time instead:
    //
    //   • the row unmounts mid-keystroke. `records` refreshes only once the write resolves, so the
    //     render right after this handler had neither the draft nor the record. A user typing
    //     `C:\tools\bash.exe` lost the row after the `C` — the first character is where the row
    //     BECOMES a flavour (C12: an executable is non-empty, not existence-checked) — and every key
    //     after it went to `document.body`. The E2E did not see it because `fill()` sets the whole
    //     value in one input event; a person types.
    //
    //   • a write that FAILS takes the row with it. The row never reaches `records`, and the draft
    //     is already gone: the user's typing is destroyed by the one event that most needs them to
    //     be able to retry. The failure itself is reported by the tab's write path (FR-006a).
    if (checkFlavourRecord(next, committedIds) === null) {
      commitRows([...records, next]);
      setError(null);
    }
  };

  return (
    <div className="map-control map-control--text" data-testid={`control-${descriptor.key}`}>
      <table className="map-control-table">
        <thead>
          <tr>
            <th>{descriptor.keyLabel ?? 'Id'}</th>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = rowKeys[index];
            const problem = problemOf(index);
            return (
              <Fragment key={rowKey}>
                <tr data-testid={`${noun}-row-${rowKey}`}>
                  {/* The id is TEXT, and not editable (C13): it keys `terminals.defaultParams`, so a
                      rename in place would silently orphan the parameters keyed to it. */}
                  <td className="map-control-key">{String(row[idKey] ?? '')}</td>
                  {columns.map((column) => (
                    <td key={column.label}>
                      <MapCell
                        column={column}
                        value={encodeCell(column.key ? row[column.key] : undefined)}
                        onCommit={(cell) =>
                          setCell(index, column, decodeCell(cell, column.key ? row[column.key] : undefined))
                        }
                        testId={`${noun}-cell-${rowKey}-${column.key ?? 'value'}`}
                      />
                    </td>
                  ))}
                  <td>
                    <IconButton
                      token="destroy"
                      title={`Remove ${rowKey}`}
                      onClick={() => removeRow(index)}
                      testId={`${noun}-remove-${rowKey}`}
                    />
                  </td>
                </tr>
                {problem ? (
                  // A row that arrived BROKEN FROM THE FILE says so in its own cell (C17). The
                  // control-level error region below is transient add/commit state and structurally
                  // cannot speak for a row that was never committed through this editor.
                  <tr className="map-control-row-error">
                    <td colSpan={columns.length + 2} role="alert" data-testid={`${noun}-row-error-${rowKey}`}>
                      {problem}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className="map-control-empty">
                No entries.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="map-control-add">
        <input
          type="text"
          className="ctl__input map-control-text"
          value={newId}
          placeholder={`New ${noun} id`}
          onChange={(e) => {
            setNewId(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addRow();
          }}
          data-testid={`${noun}-new-id`}
          aria-label={`New ${noun} id`}
        />
        <IconButton token="add" title={`Add ${noun}`} onClick={addRow} testId={`${noun}-add`} />
      </div>
      {error ? (
        <div className="map-control-error" role="alert" data-testid={`${noun}-error`}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A LIST-valued field, shown the way the Startup Params field already asks a user to type one:
 * space-separated (019, T043). A nested array editor is a capability nobody asked for.
 *
 * The round trip is chosen by what the field HOLDS — a list — not by what the control IS: the cell
 * is a text box either way, so the control type still does not flow from the data (FR-018).
 */
const encodeCell = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(String).join(' ') : value;

const decodeCell = (raw: unknown, previous: unknown): unknown =>
  Array.isArray(previous) && typeof raw === 'string'
    ? raw.split(/\s+/).filter((s) => s.length > 0)
    : raw;

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

/**
 * A free-text cell — the value the user types, committed AS they type it.
 *
 * Commit-on-change rather than commit-on-blur, exactly as the string-array row does (`Enter's job
 * is to say "done" and let go of the field'): a row of a table has no natural end to its gesture,
 * and a value that is only kept if you happen to click elsewhere afterwards is a value people lose.
 * There is nothing to validate on the way out — a text column accepts text.
 *
 * The DISPLAYED text is local while the field has focus, so it never fights the round trip out to
 * settings.json and back through the file watcher; it re-syncs from the stored value the moment
 * focus leaves.
 */
function TextCell({
  value,
  onCommit,
  testId,
}: {
  value: unknown;
  onCommit: (value: unknown) => void;
  testId: string;
}): ReactElement {
  const stored = typeof value === 'string' ? value : '';
  const [text, setText] = useState(stored);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(stored);
  }, [stored]);
  return (
    <input
      type="text"
      className="ctl__input map-control-text"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value);
      }}
      // Enter confirms, like every other box in the window. (This cell already commits as you
      // type, so Enter's job is to say "done" and let go of the field.)
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={() => {
        focused.current = false;
      }}
      data-testid={testId}
    />
  );
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

  /*
   * A TEXT column is a TEXT BOX (019, C14).
   *
   * Everything that was not `number` fell through to the `<select>` below — over
   * `allowedValues ?? options ?? []`. So a column declaring `control: 'text'` and no allowed values
   * rendered a dropdown over NOTHING: `terminals.defaultParams` has shipped as an empty select
   * since 016, a control offering no choice for a value that is free text by nature. It had no test
   * driving it, which is how it stayed that way.
   *
   * Commit on blur/Enter, exactly as the settings TextControl does — committing per keystroke would
   * write the settings file on every letter.
   */
  if (column.control === 'text') {
    return <TextCell value={value} onCommit={onCommit} testId={testId} />;
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
