import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  checkTyped,
  formatGrouped,
  isStop,
  nearestStop,
  toDisplay,
  type AppSettings,
  type FieldDescriptor,
} from '@throng/core';

import { FolderPicker } from '../common/folder-picker.js';
import { IconButton } from '../common/icon-button.js';
import { MapControl } from './map-control.js';
import { ListSettingControl } from './list-editor.js';
import { useFieldNotice } from './field-notice.js';
import { logExpected, typedProblem } from '@throng/core';

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
  /**
   * The control is shown but INERT, because a sibling value has taken its meaning away (030,
   * FR-011): `notifications.<severity>.timeoutMs` means nothing unless the mode beside it is
   * *Display for*.
   *
   * Shown rather than hidden on purpose — a control that vanishes takes the explanation with it,
   * and the user cannot see that the duration is still there waiting for the mode that uses it.
   *
   * Honoured by {@link NumberControl}, {@link ToggleControl} and {@link SelectControl} — every kind a
   * dependency is currently aimed at (044 FR-061 added the select: a preview provider's own settings
   * and Default open action are toggles, selects or numbers). A dependency aimed at another control
   * kind means honouring it there too — an ignored `disabled` would be the same silent degradation the
   * `default:` arm of {@link SettingControl} warns about.
   */
  disabled?: boolean;
  /**
   * Whether committing `value` will first ask the user (030 FR-008, 068 FR-092). The tab answers it
   * with the same check its commit path runs, so a two-keyed consent (`confirmWhen.alsoWhen`) holds
   * back only the click that really asks. Absent: the descriptor's `confirmWhen` alone decides.
   */
  asks?: (value: unknown) => boolean;
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
    // 077 FR-025 — a list is summarised in its row and edited in a modal, by the same editor it had inline.
    case 'array':
      return (
        <ListSettingControl
          descriptor={props.descriptor}
          value={props.value}
          disabled={props.disabled}
          onCommit={props.onCommit}
          editor={(draft, setDraft) => <ArrayControl {...props} value={draft} onCommit={setDraft} />}
        />
      );
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
      return (
        <ListSettingControl
          descriptor={props.descriptor}
          value={props.value}
          disabled={props.disabled}
          onCommit={props.onCommit}
          editor={(draft, setDraft) => (
            <MapControl descriptor={props.descriptor} value={draft} options={props.options} onCommit={setDraft} />
          )}
        />
      );
    default:
      // text / colour / font-family / icon / chord fall back to a text field here;
      // richer pickers live in the Themes/Key Bindings tabs (US3/US4).
      return <TextControl {...props} />;
  }
}

const testId = (key: string): string => `control-${key}`;

/**
 * A descriptor's `note` (055 R11): a sentence about the value IN FORCE where a rule between fields
 * changes it — the capture interval raised to the history window's minimum. Display only: the stored
 * value is never rewritten, so there is nothing to commit and nothing here that can write. Renders
 * nothing when the descriptor has no note, or has nothing to say right now.
 */
export function FieldNote({
  descriptor,
  settings,
  fallback,
}: {
  descriptor: FieldDescriptor;
  settings: AppSettings;
  /** What the row says when the descriptor's own note says nothing: a rule this window applied (055 FR-004b). */
  fallback?: string;
}): ReactElement | null {
  const text = descriptor.note?.(settings) ?? fallback;
  if (text === undefined) return null;
  return (
    <p className="settings-row__note" data-testid={`setting-note-${descriptor.key}`} role="note">
      {text}
    </p>
  );
}

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

function ToggleControl({
  descriptor,
  value,
  disabled,
  asks,
  onCommit,
}: SettingControlProps): ReactElement {
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
      {/* 039 FR-008a — an inert toggle honours `disabled`, which this control used to ignore.
          The doc-comment on `SettingControlProps.disabled` warned in as many words that a
          dependency aimed at another control kind means honouring it there too, and that an
          ignored `disabled` is the same silent degradation the `default:` arm warns about. This
          is the first such dependency, and the warning was right. */}
      <input
        type="checkbox"
        data-testid={testId(descriptor.key)}
        disabled={disabled}
        checked={checked}
        onChange={(e) => {
          // A value that may first ask the user (030 FR-008, 068 FR-092) is not shown early: a declined
          // question writes nothing, and an optimistic tick would then show a value that was never set.
          const willAsk =
            asks !== undefined
              ? asks(e.target.checked)
              : descriptor.confirmWhen !== undefined && e.target.checked === descriptor.confirmWhen.is;
          if (!willAsk) setOptimistic(e.target.checked);
          onCommit(e.target.checked);
        }}
      />
    </label>
  );
}

function SelectControl({
  descriptor,
  value,
  options,
  optionLabels,
  disabled,
  onCommit,
}: SettingControlProps): ReactElement {
  // Dynamic option lists (e.g. themes on disk) are real names shown verbatim; static
  // enum options are machine tokens shown in Title Case (display-only, 011 polish).
  const isDynamic = options != null;
  const opts = (options ?? descriptor.allowedValues ?? []).map(String);
  /*
   * A DECLARED name beats a derived one (030, FR-001).
   *
   * Title-Casing the token is a good guess and not always a right one: `never`/`timed`/`dismiss`
   * come out as "Never / Timed / Dismiss", and the modes are called *Never display*, *Display for*
   * and *Dismiss only*. The descriptor can now say so, which keeps the correction in the metadata
   * registry where every other configurable decision lives rather than in a lookup table in here.
   *
   * Runtime labels still win over declared ones — they name values that only exist at runtime, so a
   * descriptor could not have carried them — and the Title-Case fallback is unchanged for every
   * static enum that never declares anything.
   */
  const label = (v: string): string =>
    optionLabels?.[v] ?? descriptor.optionLabels?.[v] ?? (isDynamic ? v : humanizeOptionLabel(v));
  const current = value === undefined || value === null ? '' : String(value);
  return (
    <select
      className="ctl ctl--select"
      data-testid={testId(descriptor.key)}
      // 044 FR-061 — a provider's Default open action is inert while the provider is off. This control
      // ignored `disabled` until then, so an `enabledWhen` aimed at a select drew it live: a suspended
      // choice the user could still change, which is the silent degradation the prop's comment warns of.
      disabled={disabled}
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

function NumberControl({ descriptor, value, disabled, onCommit }: SettingControlProps): ReactElement {
  // 018 / FR-037 — the DISPLAYED value is grouped; the STORED value never is.
  //
  // `editor.maxOpenFileBytes` showed as `10485760`: eight digits with no grouping, which nobody
  // reads as ten megabytes. `formatGrouped` groups every number at every magnitude (constitution
  // 4.5.0 removed 018's five-digit floor), so `5,000` sits beside `10,000` in the same shape.
  const display = (v: unknown): string =>
    typeof v === 'number' ? formatGrouped(v) : v === undefined ? '' : String(v);

  const [text, setText] = useState<string>(() => display(value));
  /** 077 FR-008 — what is wrong with the text in the box, said while it is typed; `null` while it is fine. */
  const [message, setMessage] = useState<string | null>(null);
  const invalid = message !== null;
  // 077 FR-024 — what is wrong is said in the Preferences toast, naming the setting and its range; the box keeps only
  // its outline. An inert control cannot be typed into, so it has nothing to complain about.
  const fieldNotice = useFieldNotice(`${testId(descriptor.key)}-invalid`);
  useEffect(() => {
    fieldNotice(invalid && !disabled ? (typedProblem(text, descriptor) ?? message) : null);
  }, [fieldNotice, invalid, disabled, text, message, descriptor]);
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
    if (n === null) return;
    if (n === value) {
      // No change — nothing will come back through `value`, so release the local hold now.
      setDragging(null);
      return;
    }
    // #131 — DO NOT clear `dragging` here. The write is debounced through the settings file and the file
    // watcher, so `value` lags the release by a few frames; clearing the local value now makes `shown`
    // fall back to the pre-commit `value` for exactly that window, and the thumb visibly SNAPS BACK to
    // the old position before jumping forward when the write lands. Keep SHOWING the dropped position
    // and let the sync effect below release the hold once the committed value actually arrives in
    // `value`. Debounce the value write, not the control's displayed position.
    onCommit(n);
  };

  // Sync from the live value when it changes upstream. A NEW `value` means either the committed drag
  // write has landed or something changed the setting externally — both are the moment to release any
  // local drag hold and re-sync the field. Keyed on `value` ALONE (not `dragging`): during an active
  // drag `value` does not change — the slider only commits on release — so this never fires mid-gesture
  // and cannot fight the thumb. It fires when the debounced write returns, handing the thumb back to
  // `value` seamlessly (the committed position equals what was being shown), which is the #131 fix.
  useEffect(() => {
    setDragging(null);
    if (!focused.current) {
      setText(display(value));
      setMessage(null);
    }
  }, [value]);

  const isSlider = descriptor.control === 'slider';

  /*
   * 077 FR-004, FR-005, FR-007 — the value beside the slider is in the setting's DISPLAY unit (MB, s), as is the
   * slider's spoken value; the slider's own range stays in the STORED unit (research R1), as does the box, which holds
   * the exact value (bytes, ms). A stored value that is not one of the slider's stops — typed in the box,
   * or found in the file — greys the slider, which stays live: moving it stores the stop it lands on.
   */
  const stored = typeof shown === 'number' ? shown : undefined;
  const overridden = isSlider && dragging === null && stored !== undefined && !isStop(stored, descriptor);
  const shownText = stored === undefined ? '' : descriptor.storedUnit !== undefined ? toDisplay(stored, descriptor) : formatGrouped(stored);

  /*
   * Commit the value that is ACTUALLY IN THE BOX, read from the DOM — not the `text` state.
   *
   * `commit` fires from onBlur/Enter, and those can run before React has re-rendered with the value
   * onChange just set: a fast paste-then-tab (or a test's fill-then-blur) blurs while the handler
   * still closes over the previous `text`, so the edit is silently dropped. Reading the live input
   * value instead is immune to that — the box shows what the user sees, and that is what commits.
   * (This was a real flake: a debounce setting filled to 1500, blurred, and stayed 900.)
   */
  /*
   * 077 FR-009 — Enter or leaving the box stores a whole number within the hard bounds; past a bound it stores that
   * bound; text that is no number stores nothing and STAYS, with its message, until it is corrected or Escape puts
   * the stored value back — an entry is never discarded (040 FR-007; 018 FR-017). `checkTyped` parses with
   * `parseGrouped`, the exact inverse of `formatGrouped`, so no grouping character reaches the file (FR-038).
   */
  const commit = (raw: string): void => {
    const check = checkTyped(raw, descriptor);
    const n = check.ok ? check.value : check.clampTo;
    if (n === undefined) {
      setMessage(check.ok ? null : check.message);
      // The same refused entry confirmed again flashes its toast (one condition, one notice).
      if (!check.ok && !disabled) fieldNotice(typedProblem(raw, descriptor) ?? check.message, true);
      return;
    }
    setMessage(null);
    setText(display(n));
    if (n !== value) onCommit(n);
  };

  const restore = (): void => {
    setMessage(null);
    setText(display(value));
  };

  return (
    <span className={`ctl ctl--number${isSlider ? ' ctl--slider' : ''}`}>
      {isSlider ? (
        /*
         * 018 / FR-033 — the slider and the field drive ONE value, and each reflects the other.
         *
         * The two commit paths are reconciled deliberately. The slider needs no VALIDATION, because
         * it is bounded and stepped BY CONSTRUCTION and cannot produce an invalid value — but it
         * still defers the WRITE, because a drag fires `change` for every step it passes through and
         * committing each one would rewrite the config file dozens of times for one gesture. So it
         * shows as it moves and writes when the user lets go (`onPointerUp`/`onKeyUp`/`onBlur`). The
         * field keeps its blur/Enter commit, reading the LIVE DOM input rather than React state.
         *
         * This paragraph said "the slider commits on every `change`" until a component test
         * (`tests/component/preferences-number-control.test.ts`) asserted it and found the code doing
         * the better thing. The COMMENT had drifted; the behaviour was correct.
         *
         * It was also asserted end-to-end, by `preferences-fonts-and-sliders.e2e.ts` reading
         * settings.json mid-drag — an Electron launch to learn that a callback had not fired yet. 034
         * removed that one: the component test separates the two halves the file could not (the field
         * follows the thumb at once; the commit waits for `pointerup`), and separating them is what
         * the E2E was reaching for by reading a file at a particular moment.
         *
         * That last detail is not incidental. A fast paste-then-blur fires the commit before React
         * has re-rendered, so a handler closing over the previous state silently drops the edit — a
         * real CI flake (a debounce filled to 1500, blurred, and stayed 900). Adding a slider that
         * streams values continuously is exactly the change that would reintroduce it if the field
         * were switched to commit-on-change to "match". It is not.
         */
        <input
          type="range"
          className={overridden ? 'ctl__slider ctl__slider--overridden' : 'ctl__slider'}
          data-testid={`${testId(descriptor.key)}-slider`}
          data-overridden={overridden ? 'true' : undefined}
          aria-label={descriptor.label}
          aria-valuetext={shownText}
          disabled={disabled}
          min={descriptor.min}
          max={descriptor.max}
          // `step` has been declared since feature 007 and read by NOBODY — dead metadata describing
          // a behaviour that did not exist. This is what makes it load-bearing (FR-035).
          step={descriptor.step}
          value={stored !== undefined ? (dragging ?? nearestStop(stored, descriptor)) : (descriptor.min ?? 0)}
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
      {isSlider ? (
        <span className="ctl__value" data-testid={`${testId(descriptor.key)}-value`}>
          {shownText}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        className={invalid ? 'ctl__input ctl__input--invalid' : 'ctl__input'}
        data-testid={testId(descriptor.key)}
        aria-invalid={invalid}
        // BOTH halves, or neither. A disabled thumb beside a live text box is not an inert control —
        // it is a control with one working way in, which is worse than either honest answer.
        disabled={disabled}
        value={text}
        min={descriptor.min}
        max={descriptor.max}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          // 077 FR-008 — checked as it is typed, so a bad value is named before it is confirmed. An emptied box is a
          // value being typed, not a wrong one: it is named only if it is confirmed empty.
          const check = checkTyped(e.target.value, descriptor);
          setMessage(check.ok || e.target.value.trim() === '' ? null : check.message);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') restore();
        }}
      />
    </span>
  );
}

function TextControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value));
  // 053 FR-008 — the descriptor's own rule, when it has one. The message is held until the text is
  // edited again, and the commit is refused, so the last valid value stays what is saved.
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  // 077 FR-024 — the refusal is the Preferences toast's, naming the setting; the box keeps its outline.
  const fieldNotice = useFieldNotice(`${testId(descriptor.key)}-invalid`);
  useEffect(() => {
    fieldNotice(error === null ? null : `${descriptor.label}: ${error}`);
  }, [fieldNotice, error, descriptor.label]);
  useEffect(() => {
    if (!focused.current) {
      setText(value === undefined ? '' : String(value));
      setError(null);
    }
  }, [value]);
  /** Commit `raw` unless the descriptor rejects it; reports whether it was accepted. */
  const commit = (raw: string): boolean => {
    const message = descriptor.validate?.(raw) ?? null;
    setError(message);
    if (message !== null) {
      fieldNotice(`${descriptor.label}: ${message}`, true);
      return false;
    }
    if (raw !== value) onCommit(raw);
    return true;
  };
  return (
    <>
      <input
        type="text"
        className={error !== null ? 'ctl ctl--text ctl__input ctl__input--invalid' : 'ctl ctl--text ctl__input'}
        data-testid={testId(descriptor.key)}
        aria-invalid={error !== null}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        // ENTER COMMITS, everywhere. Blur is the only way this field used to accept an answer, so a user
        // who typed a value and pressed Enter — as anyone would — saw nothing happen, and had to guess
        // that they were supposed to click elsewhere instead. Enter is the confirm key; every box in the
        // window honours it now. A refused value keeps focus, so the message is read where it was typed.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (commit(e.currentTarget.value)) e.currentTarget.blur();
        }}
        onBlur={(e) => {
          focused.current = false;
          // Commit the live input value, not the `text` closure — same stale-render race the
          // NumberControl above fixes (a fast paste-then-tab could otherwise drop the edit).
          commit(e.currentTarget.value);
        }}
      />
    </>
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

/**
 * One entry of a list whose descriptor declares `validateItem` (074 FR-072c). It holds its own draft and writes only
 * on Enter or blur, and only an entry the rule accepts: a refused entry keeps its text and focus, and says why in
 * the Preferences toast (077 FR-024). `onCommit` is told whether the entry was written. An entry still empty when let go of calls `onEmpty` instead —
 * an added row nobody typed into is dropped, not complained about.
 */
function ValidatedArrayItem({
  id,
  label,
  value,
  validate,
  onCommit,
  onEmpty,
}: {
  id: string;
  /** The setting's label, which names the list in its toast (077 FR-024). */
  label: string;
  value: string;
  validate: (item: string) => string | null;
  onCommit: (item: string) => void;
  onEmpty?: () => void;
}): ReactElement {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  // 077 FR-024 — a refused entry is named in the Preferences toast; the box keeps its outline.
  const fieldNotice = useFieldNotice(`${id}-invalid`);
  useEffect(() => {
    fieldNotice(error === null ? null : `${label}: ${error}`);
  }, [fieldNotice, error, label]);
  useEffect(() => {
    if (!focused.current) {
      setText(value);
      setError(null);
    }
  }, [value]);
  const commit = (raw: string): boolean => {
    if (raw.trim() === '' && onEmpty !== undefined) {
      onEmpty();
      return true;
    }
    const message = validate(raw);
    setError(message);
    if (message !== null) {
      fieldNotice(`${label}: ${message}`, true);
      return false;
    }
    if (raw !== value) onCommit(raw);
    return true;
  };
  return (
    <span className="ctl__array-item">
      <input
        className={error !== null ? 'ctl__input ctl__input--invalid' : 'ctl__input'}
        data-testid={id}
        aria-invalid={error !== null}
        // An added row takes focus, so typing follows the click on Add.
        autoFocus={onEmpty !== undefined}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        // A refused entry keeps focus, so the user corrects it where it was typed.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && commit(e.currentTarget.value)) e.currentTarget.blur();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
      />
    </span>
  );
}

function StringArrayControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const items = Array.isArray(value) ? value.map(String) : [];
  const set = (next: string[]): void => onCommit(next);
  const validate = descriptor.validateItem;
  // 074 FR-072c — with a rule, Add opens an unsaved row: nothing is written until its entry passes.
  const [adding, setAdding] = useState(false);
  return (
    <div className="ctl ctl--array" data-testid={testId(descriptor.key)}>
      {items.map((item, i) => (
        <div className="ctl__array-row" key={i}>
          {validate !== undefined ? (
            <ValidatedArrayItem
              id={`${testId(descriptor.key)}-item-${i}`}
              label={descriptor.label}
              value={item}
              validate={validate}
              onCommit={(entry) => set(items.map((x, j) => (j === i ? entry : x)))}
            />
          ) : (
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
          )}
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
      {validate !== undefined && adding ? (
        <div className="ctl__array-row">
          <ValidatedArrayItem
            id={`${testId(descriptor.key)}-item-${items.length}`}
            label={descriptor.label}
            value=""
            validate={validate}
            onCommit={(entry) => {
              setAdding(false);
              set([...items, entry]);
            }}
            onEmpty={() => setAdding(false)}
          />
        </div>
      ) : null}
      <IconButton
        token="add"
        className="ctl__array-add"
        testId={`${testId(descriptor.key)}-add`}
        title="Add an entry"
        onClick={() => (validate !== undefined ? setAdding(true) : set([...items, '']))}
      />
    </div>
  );
}

function JsonArrayControl({ descriptor, value, onCommit }: SettingControlProps): ReactElement {
  const [text, setText] = useState<string>(() => JSON.stringify(value ?? [], null, 2));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  // 077 FR-024 — said in the Preferences toast; the box keeps its outline.
  const problem = `${descriptor.label} must be a valid JSON array`;
  const fieldNotice = useFieldNotice(`${testId(descriptor.key)}-invalid`);
  useEffect(() => {
    fieldNotice(invalid ? problem : null);
  }, [fieldNotice, invalid, problem]);
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
    } catch (error) {
      logExpected('form-controls: parse a JSON array field', 'the user typed something that is not a JSON array; the field is marked invalid', error);
      setInvalid(true);
      fieldNotice(problem, true);
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
    </span>
  );
}
