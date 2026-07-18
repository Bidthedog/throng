import { useEffect, useRef, useState, type ReactElement } from 'react';
import { formatGrouped, parseGrouped, type FieldDescriptor } from '@throng/core';

import { FolderPicker } from '../common/folder-picker.js';
import { IconButton } from '../common/icon-button.js';
import { MapControl } from './map-control.js';

/**
 * Generic descriptor-driven form controls (feature 007, FR-028/029). One control
 * per {@link FieldDescriptor}, chosen by `descriptor.control` and matched to the
 * value type. Discrete controls (toggle/select/array) commit immediately; free
 * text/number commit on blur/Enter and refuse invalid values (FR-017), surfacing
 * the invalidity while keeping the last valid value in effect. Theme-specific
 * controls (colour/font/icon/chord) are provided by their own tabs; this module
 * covers the settings + shared kinds.
 */
export interface SettingControlProps {
  descriptor: FieldDescriptor;
  value: unknown;
  /** Dynamic option override for a select whose values aren't static (e.g. themes). */
  options?: readonly (string | number)[];
  /**
   * What to CALL each dynamic option, where the value is an internal id (019, FR-016).
   *
   * The detected built-ins are offered by id — `cmd` is what the setting stores — but `cmd` is not
   * what Command Prompt is called. The stored value is unchanged; this is display only.
   */
  optionLabels?: Readonly<Record<string, string>>;
  /** Apply a valid new value (the tab wires this to the config-write path). */
  onCommit: (value: unknown) => void;
}

export function SettingControl(props: SettingControlProps): ReactElement {
  const { descriptor } = props;
  switch (descriptor.control) {
    case 'toggle':
      return <ToggleControl {...props} />;
    case 'select':
    case 'enum':
      return <SelectControl {...props} />;
    case 'multiselect':
      return <MultiSelectControl {...props} />;
    case 'slider':
    case 'number':
    case 'font-size':
      return <NumberControl {...props} />;
    case 'array':
      return <ArrayControl {...props} />;
    case 'folder':
      return <FolderControl {...props} />;
    // A keyed map (016). WITHOUT this case it falls through to `default:` and renders as a TEXT
    // FIELD showing "[object Object]" — which is not a crash, not a type error, and not caught by
    // anything: the descriptor is valid, the control is valid, and the user simply sees nonsense.
    // That silent degradation is why the default arm is dangerous, and why this case exists.
    // …and `records` is an ARRAY of records (019, FR-018/FR-020) — the same table in its records
    // mode, never a second one. It needs this arm for exactly the reason above: without it
    // `terminals.flavours` does not crash, it renders as a TEXT FIELD full of "[object Object]".
    case 'map':
    case 'records':
      return <MapControl {...props} />;
    default:
      // text / colour / font-family / icon / chord fall back to a text field here;
      // richer pickers live in the Themes/Key Bindings tabs (US3/US4).
      return <TextControl {...props} />;
  }
}

const testId = (key: string): string => `control-${key}`;

/** Abbreviations that must not be naively Title-cased (e.g. line endings). */
const OPTION_LABEL_OVERRIDES: Record<string, string> = {
  lf: 'LF',
  crlf: 'CRLF',
  cr: 'CR',
};

/**
 * Display label for a static enum option value (011 polish): the stored value is a
 * machine token (`lastViewed`, `override`, `tab`, …) but the dropdown shows it in
 * Title Case (`Last Viewed`, `Override`, `Tab`). The JSON value is unchanged — this
 * is display-only. Dynamic option lists (theme/font names) are shown verbatim.
 */
function humanizeOptionLabel(value: string): string {
  if (value in OPTION_LABEL_OVERRIDES) return OPTION_LABEL_OVERRIDES[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase boundaries
    .replace(/[_-]+/g, ' ') // and any snake/kebab separators
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function ToggleControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  /**
   * The click shows AT ONCE; the stored value catches up.
   *
   * A checkbox driven purely by the stored value could not move until that value came back — and on the
   * Themes tab it comes back the long way round: through a debounced write, out to the theme file, back
   * in through the file watcher, and into the config store. So you clicked Bold and the box stayed
   * empty for a moment, which reads exactly like a control that does not work. (It is why "I can't
   * change the font settings" and "clicking does nothing" are the same bug wearing two hats.)
   *
   * The optimistic value is dropped the instant the real one arrives, so the store always has the last
   * word — this shortens the wait, it does not invent an answer.
   */
  const stored = value === true;
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [value]);
  const checked = optimistic ?? stored;

  return (
    <label className="ctl ctl--toggle">
      <input
        type="checkbox"
        data-testid={testId(descriptor.key)}
        checked={checked}
        onChange={(e) => {
          setOptimistic(e.target.checked);
          onCommit(e.target.checked);
        }}
      />
    </label>
  );
}

function SelectControl({ descriptor, value, options, onCommit }: SettingControlProps): ReactElement {
  // Dynamic option lists (e.g. themes on disk) are real names shown verbatim; static
  // enum options are machine tokens shown in Title Case (display-only, 011 polish).
  const isDynamic = options != null;
  const opts = (options ?? descriptor.allowedValues ?? []).map(String);
  const label = (v: string): string => (isDynamic ? v : humanizeOptionLabel(v));
  const current = value === undefined || value === null ? '' : String(value);
  return (
    <select
      className="ctl ctl--select"
      data-testid={testId(descriptor.key)}
      value={current}
      onChange={(e) => onCommit(e.target.value)}
    >
      {/* If the current value isn't among the options (dynamic list still loading),
          keep it visible so we never silently drop it. */}
      {!opts.includes(current) && current !== '' ? (
        <option value={current}>{label(current)}</option>
      ) : null}
      {opts.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}

function MultiSelectControl({
  descriptor,
  value,
  options,
  optionLabels,
  onCommit,
}: SettingControlProps): ReactElement {
  /**
   * The tick shows AT ONCE; the stored value catches up — the same reasoning as {@link
   * ToggleControl}, and the same bug if it is missing.
   *
   * A checkbox driven purely by the stored value cannot move until that value has been written to
   * settings.json, read back through the file watcher and re-parsed into the config store. You
   * click, nothing happens, and the control reads as broken. The optimistic value is dropped the
   * instant the real one arrives, so the store always has the last word.
   */
  const stored = Array.isArray(value) ? value.map(String) : [];
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  useEffect(() => setOptimistic(null), [value]);
  const selected = optimistic ?? stored;
  /*
   * The DYNAMIC options win where they exist (019, FR-016).
   *
   * This control read `descriptor.allowedValues` and nothing else, so it could only ever offer a
   * set known at authoring time — and `terminals.disabledBuiltins`'s set is the built-ins THIS
   * MACHINE has, which is discovered at runtime. A control that cannot be told what to offer is a
   * control the only setting that needs it cannot use.
   *
   * An empty catalogue renders an EMPTY PICKER, never a text box: detection finding nothing is not
   * a reason to ask the user to type an id no one can check (007 FR-029).
   */
  const catalogue = (options ?? descriptor.allowedValues ?? []).map(String);
  /*
   * A SELECTED value the catalogue does not offer is still offered — so it can be un-selected.
   *
   * `selected` only drives `checked`, so a value absent from the catalogue had no control at all: it
   * was live in the settings file and unreachable from the form. `terminals.disabledBuiltins` makes
   * that a one-way door across machines — hide `git-bash` where Git is installed, sync settings.json
   * to a machine without it, and detection never offers the id back. The only way to un-hide it is
   * the JSON tab, which is the very door C10/FR-017 exists to prevent, one layer up.
   *
   * The precedent is {@link SelectControl}, twelve lines above: a current value missing from a
   * dynamic list is kept visible "so we never silently drop it". Appended, never swapped in — the
   * catalogue keeps its own order, and the orphans follow it.
   */
  const opts = [...catalogue, ...selected.filter((s) => !catalogue.includes(s))];
  const toggle = (o: string): void => {
    const next = selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o];
    setOptimistic(next);
    onCommit(next);
  };
  return (
    <div className="ctl ctl--multiselect" data-testid={testId(descriptor.key)}>
      {opts.map((o) => (
        <label key={o} className="ctl__check">
          {/* The VALUE is the id the setting stores; the TEXT is what the thing is called. */}
          <input
            type="checkbox"
            value={o}
            checked={selected.includes(o)}
            onChange={() => toggle(o)}
          />
          {optionLabels?.[o] ?? o}
        </label>
      ))}
    </div>
  );
}

function NumberControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  // 018 / FR-037 — the DISPLAYED value is grouped; the STORED value never is.
  //
  // `editor.maxOpenFileBytes` showed as `10485760`: eight digits with no grouping, which nobody
  // reads as ten megabytes. `formatGrouped` leaves anything under five digits alone, because a
  // 5000 ms delay rendered as `5,000` reads as a typo rather than a kindness.
  const display = (v: unknown): string =>
    typeof v === 'number' ? formatGrouped(v) : v === undefined ? '' : String(v);

  const [text, setText] = useState<string>(() => display(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  /**
   * The value the slider is showing WHILE IT IS BEING DRAGGED, before it has been written anywhere.
   *
   * A range input fires `change` on every pixel of travel, and the slider committed on every one of
   * them — so dragging a font size from 12 to 40 wrote the settings file twenty-eight times, and every
   * one of those writes went out to disk, came back through the file watcher, and re-themed the entire
   * application mid-drag. The theming is the part you can see: the whole window flickers through every
   * size on the way to the one you wanted.
   *
   * So the drag is now LOCAL and the write is DEBOUNCED: the slider and its field follow your thumb at
   * once, and the application is re-themed once, when you stop.
   */
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;

  /*
   * The write happens when you LET GO — not on a timer.
   *
   * A range input fires `change` on every pixel of travel, and each one used to be written to the
   * settings file, read back through the file watcher, and re-themed into the whole application: the
   * window flickered through every value on the way to the one you wanted. A 300ms debounce fixed the
   * flicker but replaced it with a lag — you stopped, and a moment later the application caught up,
   * which feels like something is wrong with it.
   *
   * A slider has a gesture with a natural END: the pointer comes up. So that is when it commits. The
   * keyboard has one too — the key comes up — and typing a number in the box beside it still commits on
   * Enter or blur. No timer, so nothing to wait for and nothing to tune.
   */
  const commitDrag = (): void => {
    const n = dragging;
    setDragging(null);
    if (n !== null && n !== value) onCommit(n);
  };

  // Sync from the live value when not being edited.
  useEffect(() => {
    if (!focused.current && dragging === null) {
      setText(display(value));
      setInvalid(false);
    }
  }, [value, dragging]);

  const parse = (raw: string): number | null => {
    // `parseGrouped` is the exact inverse of `formatGrouped` for the active locale, so the
    // separators the field just PUT IN come straight back out — and a grouping character can never
    // reach the settings file (FR-038). A bare `Number(raw)` would simply reject `10,485,760`.
    const n = parseGrouped(raw);
    if (n === null) return null;
    if (descriptor.min !== undefined && n < descriptor.min) return null;
    if (descriptor.max !== undefined && n > descriptor.max) return null;
    return n;
  };

  const isSlider = descriptor.control === 'slider';

  /*
   * Commit the value that is ACTUALLY IN THE BOX, read from the DOM — not the `text` state.
   *
   * `commit` fires from onBlur/Enter, and those can run before React has re-rendered with the value
   * onChange just set: a fast paste-then-tab (or a test's fill-then-blur) blurs while the handler
   * still closes over the previous `text`, so the edit is silently dropped. Reading the live input
   * value instead is immune to that — the box shows what the user sees, and that is what commits.
   * (This was a real flake: a debounce setting filled to 1500, blurred, and stayed 900.)
   */
  const commit = (raw: string): void => {
    const n = parse(raw);
    if (n === null) {
      setInvalid(true); // not applied; last valid value remains (FR-017)
      return;
    }
    setInvalid(false);
    if (n !== value) onCommit(n);
  };

  return (
    <span className={`ctl ctl--number${isSlider ? ' ctl--slider' : ''}`}>
      {isSlider ? (
        /*
         * 018 / FR-033 — the slider and the field drive ONE value, and each reflects the other.
         *
         * The two commit paths are reconciled deliberately. The slider commits on every `change`,
         * because it is bounded and stepped BY CONSTRUCTION: it cannot produce an invalid value, so
         * there is nothing to validate and nothing to defer. The field keeps its blur/Enter commit,
         * reading the LIVE DOM input rather than React state.
         *
         * That last detail is not incidental. A fast paste-then-blur fires the commit before React
         * has re-rendered, so a handler closing over the previous state silently drops the edit — a
         * real CI flake (a debounce filled to 1500, blurred, and stayed 900). Adding a slider that
         * streams values continuously is exactly the change that would reintroduce it if the field
         * were switched to commit-on-change to "match". It is not.
         */
        <input
          type="range"
          className="ctl__slider"
          data-testid={`${testId(descriptor.key)}-slider`}
          aria-label={descriptor.label}
          min={descriptor.min}
          max={descriptor.max}
          // `step` has been declared since feature 007 and read by NOBODY — dead metadata describing
          // a behaviour that did not exist. This is what makes it load-bearing (FR-035).
          step={descriptor.step}
          value={typeof shown === 'number' ? shown : (descriptor.min ?? 0)}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Show it NOW — in the slider and in the field beside it, which must agree with the thumb
            // the user is holding. Write it when they let go.
            setDragging(n);
            setText(display(n));
          }}
          onPointerUp={commitDrag}
          onKeyUp={commitDrag}
          onBlur={commitDrag}
        />
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        className={invalid ? 'ctl__input ctl__input--invalid' : 'ctl__input'}
        data-testid={testId(descriptor.key)}
        aria-invalid={invalid}
        value={text}
        min={descriptor.min}
        max={descriptor.max}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
        }}
      />
      {invalid ? (
        <span className="ctl__error" data-testid={`${testId(descriptor.key)}-invalid`}>
          Enter a number{descriptor.min !== undefined ? ` ≥ ${descriptor.min}` : ''}
          {descriptor.max !== undefined ? ` ≤ ${descriptor.max}` : ''}.
        </span>
      ) : null}
    </span>
  );
}

function TextControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <input
      type="text"
      className="ctl ctl--text ctl__input"
      data-testid={testId(descriptor.key)}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      // ENTER COMMITS, everywhere. Blur is the only way this field used to accept an answer, so a user
      // who typed a value and pressed Enter — as anyone would — saw nothing happen, and had to guess
      // that they were supposed to click elsewhere instead. Enter is the confirm key; every box in the
      // window honours it now.
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const raw = e.currentTarget.value;
        if (raw !== value) onCommit(raw);
        e.currentTarget.blur();
      }}
      onBlur={(e) => {
        focused.current = false;
        // Commit the live input value, not the `text` closure — same stale-render race the
        // NumberControl above fixes (a fast paste-then-tab could otherwise drop the edit).
        const raw = e.currentTarget.value;
        if (raw !== value) onCommit(raw);
      }}
    />
  );
}

/** Folder path control (011, FR-042/042a): the shared FolderPicker — an editable path
 *  field plus a themeable browse icon that opens the OS dialog on demand. The settings
 *  variant NEVER auto-pops (no `autoOpenOnMount`): typing commits on blur (like the other
 *  text settings), and browsing commits the picked folder immediately. */
function FolderControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <FolderPicker
      value={text}
      onChange={(p) => {
        focused.current = true;
        setText(p);
      }}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onCommit(text);
      }}
      onPick={(p) => {
        focused.current = false;
        onCommit(p);
      }}
      defaultPath={typeof value === 'string' && value.length > 0 ? value : undefined}
      browseTitle="Browse for a folder"
      placeholder="Folder path"
      inputClassName="ctl ctl--text ctl__input"
      inputTestId={testId(descriptor.key)}
      browseTestId={`${testId(descriptor.key)}-browse`}
    />
  );
}

/** Array editor. String arrays get an add/remove/reorder list; a non-string array
 *  (e.g. terminal flavours) gets a validated JSON editor so it stays UI-editable. */
function ArrayControl(props: SettingControlProps): ReactElement {
  const isStringArray =
    props.descriptor.itemControl === 'text' ||
    (Array.isArray(props.value) && props.value.every((v) => typeof v === 'string'));
  return isStringArray ? <StringArrayControl {...props} /> : <JsonArrayControl {...props} />;
}

function StringArrayControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const items = Array.isArray(value) ? value.map(String) : [];
  const set = (next: string[]): void => onCommit(next);
  return (
    <div className="ctl ctl--array" data-testid={testId(descriptor.key)}>
      {items.map((item, i) => (
        <div className="ctl__array-row" key={i}>
          <input
            className="ctl__input"
            data-testid={`${testId(descriptor.key)}-item-${i}`}
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              set(next);
            }}
            // Enter confirms, like every other box in the window. (This row already commits as you
            // type, so Enter's job is to say "done" and let go of the field.)
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <IconButton
            token="moveUp"
            className="ctl__array-btn"
            title="Move up"
            disabled={i === 0}
            onClick={() => {
              const next = [...items];
              [next[i - 1], next[i]] = [next[i], next[i - 1]];
              set(next);
            }}
          />
          <IconButton
            token="moveDown"
            className="ctl__array-btn"
            title="Move down"
            disabled={i === items.length - 1}
            onClick={() => {
              const next = [...items];
              [next[i + 1], next[i]] = [next[i], next[i + 1]];
              set(next);
            }}
          />
          <IconButton
            token="destroy"
            className="ctl__array-btn"
            testId={`${testId(descriptor.key)}-remove-${i}`}
            title="Remove"
            onClick={() => set(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <IconButton
        token="add"
        className="ctl__array-add"
        testId={`${testId(descriptor.key)}-add`}
        title="Add an entry"
        onClick={() => set([...items, ''])}
      />
    </div>
  );
}

function JsonArrayControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(() => JSON.stringify(value ?? [], null, 2));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(JSON.stringify(value ?? [], null, 2));
      setInvalid(false);
    }
  }, [value]);
  const commit = (): void => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      setInvalid(false);
      onCommit(parsed);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <span className="ctl ctl--json-array">
      <textarea
        className={invalid ? 'ctl__textarea ctl__input--invalid' : 'ctl__textarea'}
        data-testid={testId(descriptor.key)}
        aria-invalid={invalid}
        rows={4}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
      />
      {invalid ? (
        <span className="ctl__error" data-testid={`${testId(descriptor.key)}-invalid`}>
          Must be a valid JSON array.
        </span>
      ) : null}
    </span>
  );
}
