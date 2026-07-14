import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FieldDescriptor } from '@throng/core';
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
    case 'map':
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
  const checked = value === true;
  return (
    <label className="ctl ctl--toggle">
      <input
        type="checkbox"
        data-testid={testId(descriptor.key)}
        checked={checked}
        onChange={(e) => onCommit(e.target.checked)}
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

function MultiSelectControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const selected = Array.isArray(value) ? value.map(String) : [];
  const opts = (descriptor.allowedValues ?? []).map(String);
  const toggle = (o: string): void => {
    const next = selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o];
    onCommit(next);
  };
  return (
    <div className="ctl ctl--multiselect" data-testid={testId(descriptor.key)}>
      {opts.map((o) => (
        <label key={o} className="ctl__check">
          <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

function NumberControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  // Sync from the live value when not being edited.
  useEffect(() => {
    if (!focused.current) {
      setText(value === undefined ? '' : String(value));
      setInvalid(false);
    }
  }, [value]);

  const parse = (raw: string): number | null => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return null;
    if (descriptor.min !== undefined && n < descriptor.min) return null;
    if (descriptor.max !== undefined && n > descriptor.max) return null;
    return n;
  };

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
    <span className="ctl ctl--number">
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
