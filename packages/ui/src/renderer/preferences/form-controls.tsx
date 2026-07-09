import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FieldDescriptor } from '@throng/core';

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
    default:
      // text / colour / font-family / icon / chord fall back to a text field here;
      // richer pickers live in the Themes/Key Bindings tabs (US3/US4).
      return <TextControl {...props} />;
  }
}

const testId = (key: string): string => `control-${key}`;

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
  const opts = (options ?? descriptor.allowedValues ?? []).map(String);
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
      {!opts.includes(current) && current !== '' ? <option value={current}>{current}</option> : null}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
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

  const commit = (): void => {
    const n = parse(text);
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
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
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
      onBlur={() => {
        focused.current = false;
        if (text !== value) onCommit(text);
      }}
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
          <button
            type="button"
            className="ctl__array-btn"
            title="Move up"
            disabled={i === 0}
            onClick={() => {
              const next = [...items];
              [next[i - 1], next[i]] = [next[i], next[i - 1]];
              set(next);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="ctl__array-btn"
            title="Move down"
            disabled={i === items.length - 1}
            onClick={() => {
              const next = [...items];
              [next[i + 1], next[i]] = [next[i], next[i + 1]];
              set(next);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="ctl__array-btn"
            data-testid={`${testId(descriptor.key)}-remove-${i}`}
            title="Remove"
            onClick={() => set(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ctl__array-add"
        data-testid={`${testId(descriptor.key)}-add`}
        onClick={() => set([...items, ''])}
      >
        + Add
      </button>
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
