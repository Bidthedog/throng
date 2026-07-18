import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  SETTINGS_METADATA,
  buildShippedDefaults,
  emptyValueFor,
  filterFields,
  getAtPath,
  isSettingOverridden,
  LANGUAGES,
  setAtPath,
  settingDiffersFromEntry,
  type FieldDescriptor,
} from '@throng/core';
import type { DetectedFlavourDto } from '../global.js';
import { useAppSettings } from '../config/config-store.js';
import { debounce } from '../config/write-config.js';
import { IconButton } from '../common/icon-button.js';
import { useResetNotice } from './reset-notice.js';
import { useOnEntry } from './on-entry.js';
import { RowActions } from './row-actions.js';
import { SettingControl } from './form-controls.js';
import { createApplyClient } from './apply-client.js';

/**
 * The Settings tab (feature 007, US2 — FR-026/027/028). A generic form rendered
 * entirely from {@link SETTINGS_METADATA}: descriptors grouped into labelled
 * sections, each row a label + description + a type-matched control. Editing a
 * control writes the whole settings document via the immediate-apply pipeline
 * (FR-016); the write rides the config watcher so the running app reacts live.
 *
 * FR-043 (form side): the values come from `useAppSettings()`, which is the
 * tolerant, defaults-merged parse of `settings.json`. A malformed file therefore
 * renders the defaults-merged form here without crashing, and a subsequent valid
 * edit repairs the file on write.
 *
 * FR-049: a typeahead at the top narrows the form to the settings matching any
 * typed word (name / description / value). Typing is never blocked — the query
 * updates the field immediately and the filter settles after a short debounce.
 */

/** How long the typeahead waits after the last keystroke before filtering. */
const SEARCH_DEBOUNCE_MS = 150;

function groupDescriptors(items: readonly FieldDescriptor[]): {
  group: string;
  items: FieldDescriptor[];
}[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();
  for (const d of items) {
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

/** The shipped record is frozen and pure — build it once for the overridden-test. */
const SHIPPED = buildShippedDefaults();

export function SettingsTab({
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
}: {
  searchDebounceMs?: number;
} = {}): ReactElement {
  const settings = useAppSettings();
  const entry = useOnEntry().settings;
  const { report } = useResetNotice();
  const apply = useMemo(() => createApplyClient({ kind: 'settings' }), []);

  // `query` drives the input (instant); `applied` drives the filter (debounced).
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const applySearch = useMemo(
    () => debounce((q: string) => setApplied(q), searchDebounceMs),
    [searchDebounceMs],
  );
  useEffect(() => () => applySearch.cancel(), [applySearch]);

  const onSearchChange = (next: string): void => {
    setQuery(next);
    applySearch(next);
  };
  const clearSearch = (): void => {
    applySearch.cancel(); // the reset is immediate, never debounced
    setQuery('');
    setApplied('');
  };

  const matches = useMemo(
    () => filterFields(applied, SETTINGS_METADATA, (d) => getAtPath(settings, d.key)),
    [applied, settings],
  );
  const groups = useMemo(() => groupDescriptors(matches), [matches]);

  // Dynamic options for the theme selector (the themes present on disk).
  const [themes, setThemes] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    // listThemes lands with the Themes phase (US4); until then this rejects and we
    // simply keep the current value as the only option.
    void window.throng?.config
      ?.listThemes?.()
      .then((list) => {
        if (active) setThemes(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  /**
   * The built-ins this machine actually has — the hidden-built-ins picker's catalogue (019, C10).
   *
   * Fetched once, exactly as the theme list above is, because the answer arrives over IPC and the
   * form renders before it does. It comes from `listDetectedFlavours`, NOT `listFlavours`: the
   * latter has already subtracted the hidden ones, so a picker built from it could not offer back
   * the built-in the user just hid, and hiding would be a one-way door.
   */
  const [detected, setDetected] = useState<DetectedFlavourDto[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.resolve(window.throng?.terminal?.listDetectedFlavours?.())
      .then((list) => {
        // Detection finding nothing renders an EMPTY picker — never a text box (007 FR-029).
        if (active && Array.isArray(list)) setDetected(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  /**
   * Apply an edit — and SAY SO when it could not be applied (FR-006a).
   *
   * The `ConfigWriteResult` used to be dropped on the floor here (`void apply.applyNow(next)`), so a
   * write that failed left the form showing a value the settings file does not contain, with nothing
   * said anywhere: the silent-config-write class of #75, on the way out instead of the way in. The
   * reporter is the one the reset path has always used — the failure is the same failure, and
   * "nothing was changed" is a promise the atomic write actually keeps.
   *
   * It takes the DESCRIPTOR rather than a bare key because a message has to name the setting the way
   * the user does. `notify` replaces a notice carrying the same test id, so a control that commits as
   * you type reports one failure, not one per keystroke.
   */
  const commit = (d: FieldDescriptor, value: unknown): void => {
    const next = setAtPath(settings, d.key, value);
    void apply.applyNow(next).then(
      (r) => report(`Saving ${d.label}`, r),
      // A throw is the bridge itself failing — still a failure, still not silent.
      () => report(`Saving ${d.label}`, undefined),
    );
  };

  /**
   * A row's value is clearable when the field declares empty a valid value for it AND it is not
   * already empty — offering "clear" on an empty value is offering a no-op (the same reasoning
   * that hides the reset affordance on a row that is not overridden, FR-004a).
   */
  /**
   * Options a descriptor cannot declare statically, because they are discovered at runtime.
   *
   * Generalised from a single hard-coded check for the theme list: 016 adds a second such field (the
   * language column of `editor.languageByExtension`), and a third would have meant a third `d.key
   * === …` in the JSX. The list of languages is the registry's, so a language added to the registry
   * appears here without anyone remembering to update a settings file.
   */
  const dynamicOptions = (
    d: FieldDescriptor,
    themeNames: readonly string[],
    detectedFlavours: readonly DetectedFlavourDto[],
  ): readonly (string | number)[] | undefined => {
    if (d.key === 'appearance.theme') return themeNames;
    if (d.key === 'editor.languageByExtension') return LANGUAGES.map((l) => l.id);
    // Every detected built-in is offered — INCLUDING the ones currently hidden, which show checked
    // (019, FR-017). The catalogue is the detected set, never the visible set.
    if (d.key === 'terminals.disabledBuiltins') return detectedFlavours.map((f) => f.id);
    return undefined;
  };

  /** What an option's id is CALLED — `cmd` stores, "Command Prompt" reads (019, FR-016). */
  const dynamicOptionLabels = (
    d: FieldDescriptor,
    detectedFlavours: readonly DetectedFlavourDto[],
  ): Record<string, string> | undefined => {
    if (d.key !== 'terminals.disabledBuiltins') return undefined;
    return Object.fromEntries(detectedFlavours.map((f) => [f.id, f.label]));
  };

  /**
   * Is there anything TO clear?
   *
   * The old rule tested `value !== ''`, which is true of every object — so an already-EMPTY map lit
   * its clear button, and clicking it did nothing at all. A control that offers an action it cannot
   * perform teaches the user to distrust the ones that can (016, F6).
   */
  const canClear = (d: FieldDescriptor): boolean => {
    if (!d.clearable) return false;
    const value = getAtPath(settings, d.key);
    if (Array.isArray(value)) return value.length > 0;
    if (value !== null && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== '';
  };

  return (
    <div className="settings-form" data-testid="settings-tab">
      <div className="settings-search">
        <input
          type="text"
          className="settings-search__input"
          data-testid="settings-search"
          placeholder="Search settings…"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {query ? (
          <IconButton
            token="dismiss"
            className="settings-search__clear"
            testId="settings-search-clear"
            title="Clear search"
            onClick={clearSearch}
          />
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="settings-search__empty" data-testid="settings-search-empty">
          No settings match “{query}”.
        </p>
      ) : null}

      {groups.map(({ group, items }) => (
        <section className="settings-group" key={group} data-testid={`settings-group-${group}`}>
          <h3 className="settings-group__title">{group}</h3>
          {items.map((d) => (
            <div className="settings-row" key={d.key} data-testid={`setting-${d.key}`}>
              <div className="settings-row__meta">
                <label className="settings-row__label">{d.label}</label>
                <p className="settings-row__desc">{d.description}</p>
              </div>
              <div className="settings-row__control">
                <SettingControl
                  descriptor={d}
                  value={getAtPath(settings, d.key)}
                  options={dynamicOptions(d, themes, detected)}
                  optionLabels={dynamicOptionLabels(d, detected)}
                  onCommit={(v) => commit(d, v)}
                />
              </div>
              <RowActions
                kind="setting"
                itemKey={d.key}
                label={d.label}
                overridden={isSettingOverridden(settings, d.key, SHIPPED)}
                changed={settingDiffersFromEntry(settings, entry, d.key)}
                clearable={canClear(d)}
                onReset={() => {
                  // A reset restores the SHIPPED value, so it goes through feature 010's record in
                  // the main process — never a value this renderer computed (FR-011b).
                  //
                  // `Promise.resolve` + a rejection handler: optional chaining short-circuits the
                  // WHOLE chain when the bridge is missing, and a throw inside the handler would be
                  // an unhandled rejection — both are the silent failure FR-006a forbids.
                  void Promise.resolve(window.throng?.config?.resetSetting?.(d.key)).then(
                    (r) => report(`Resetting ${d.label}`, r),
                    () => report(`Resetting ${d.label}`, undefined),
                  );
                }}
                // Revert and clear are ordinary EDITS — to a remembered value and to an empty one
                // — so they take the same write path as typing in the box. Only a reset consults
                // the shipped record, and only a reset needs an IPC channel of its own.
                onRevert={() => commit(d, getAtPath(entry, d.key))}
                onClear={() => commit(d, emptyValueFor(d))}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
