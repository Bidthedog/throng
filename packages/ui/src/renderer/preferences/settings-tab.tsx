import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  SETTINGS_METADATA,
  buildShippedDefaults,
  emptyValueFor,
  filterFields,
  getAtPath,
  isSettingOverridden,
  setAtPath,
  settingDiffersFromEntry,
  type FieldDescriptor,
} from '@throng/core';
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

  // Flush any pending debounced apply when the window is unmounted/closed.
  useEffect(() => () => apply.flush(), [apply]);

  const commit = (key: string, value: unknown): void => {
    const next = setAtPath(settings, key, value);
    void apply.applyNow(next);
  };

  /**
   * A row's value is clearable when the field declares empty a valid value for it AND it is not
   * already empty — offering "clear" on an empty value is offering a no-op (the same reasoning
   * that hides the reset affordance on a row that is not overridden, FR-004a).
   */
  const canClear = (d: FieldDescriptor): boolean => {
    if (!d.clearable) return false;
    const value = getAtPath(settings, d.key);
    return Array.isArray(value) ? value.length > 0 : value !== '';
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
                  options={d.key === 'appearance.theme' ? themes : undefined}
                  onCommit={(v) => commit(d.key, v)}
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
                onRevert={() => commit(d.key, getAtPath(entry, d.key))}
                onClear={() => commit(d.key, emptyValueFor(d))}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
