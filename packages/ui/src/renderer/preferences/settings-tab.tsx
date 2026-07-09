import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  SETTINGS_METADATA,
  filterFields,
  getAtPath,
  setAtPath,
  type FieldDescriptor,
} from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { debounce } from '../config/write-config.js';
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

/** The reset affordance inside the typeahead — clears the query in one click. */
function ClearIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22z"
      />
    </svg>
  );
}

export function SettingsTab({
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
}: {
  searchDebounceMs?: number;
} = {}): ReactElement {
  const settings = useAppSettings();
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
          <button
            type="button"
            className="settings-search__clear"
            data-testid="settings-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={clearSearch}
          >
            <ClearIcon />
          </button>
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
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
