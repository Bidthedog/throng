import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  COMMAND_SCOPES,
  KEYBINDINGS_METADATA,
  applyRemove,
  bindingDiffersFromEntry,
  buildShippedDefaults,
  filterFields,
  isBindingOverridden,
  scopeNames,
  type ActionId,
  type FieldDescriptor,
} from '@throng/core';
import { useKeybindings } from '../config/config-store.js';
import { debounce, writeConfig } from '../config/write-config.js';
import { IconButton } from '../common/icon-button.js';
import { useResetNotice } from './reset-notice.js';
import { useOnEntry } from './on-entry.js';
import { RowActions } from './row-actions.js';
import { CaptureModal } from './capture-modal.js';

/**
 * The Key Bindings tab (feature 007, US3 + H2 — FR-030/031/033b). A grouped list
 * of bindings from {@link KEYBINDINGS_METADATA}, each row showing the action's
 * label, description, and current chord(s) as **deletable pills**. Double-clicking
 * a row opens the capture modal (FR-031) which ADDS a chord (FR-033); each pill's
 * remove control — and a right-click context menu — removes just that chord (FR-033b).
 * All changes write keybindings.json via the immediate-apply path.
 *
 * Feature 015 adds the per-action **reset** affordance (FR-001/FR-004a): it appears on a
 * row only while that action's chord SET differs from the shipped one, so it doubles as
 * the row's "modified" cue, and clicking it restores the FULL shipped chord set through
 * feature 010's reset API — immediately, with no confirmation (a single binding is a low
 * blast radius and instantly re-editable). Alongside it sit **revert** (back to the chords this
 * window opened with) and **clear** (unbind the action entirely) — FR-016.
 *
 * FR-017 adds the typeahead the Settings tab has always had. With ~50 actions the list cannot be
 * scanned, and the filter behind it is the SAME `filterFields` the Settings tab uses: it is
 * generic over how a field's value is fetched, so handing it an action's chord array makes the
 * chords searchable too — find a binding by what it is bound TO, not just by its name.
 */
/** The shipped record is frozen and pure — build it once for the overridden-test. */
const SHIPPED = buildShippedDefaults();

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

interface ChordMenu {
  action: ActionId;
  token: string;
  x: number;
  y: number;
}

export function KeybindingsTab({
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
}: {
  searchDebounceMs?: number;
} = {}): ReactElement {
  const keybindings = useKeybindings();
  const entry = useOnEntry().keybindings;
  const { report } = useResetNotice();
  const [capturing, setCapturing] = useState<{ action: ActionId; label: string } | null>(null);
  const [chordMenu, setChordMenu] = useState<ChordMenu | null>(null);

  // `query` drives the input (instant); `applied` drives the filter (debounced) — the same
  // split the Settings tab uses, so typing is never blocked by the filter.
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
    applySearch.cancel(); // the clear is immediate, never debounced
    setQuery('');
    setApplied('');
  };

  const matches = useMemo(
    // The chords ARE the value here, so they land in the haystack: searching "ctrl+shift+p"
    // finds the action bound to it.
    () => filterFields(applied, KEYBINDINGS_METADATA, (d) => keybindings.bindings[d.key] ?? []),
    [applied, keybindings],
  );
  const groups = useMemo(() => groupDescriptors(matches), [matches]);

  const writeBindings = (next: Record<string, string[]>): void => {
    void writeConfig(
      { kind: 'keybindings' },
      JSON.stringify({ version: keybindings.version, bindings: next }),
    );
  };

  const applyBindings = (next: Record<string, string[]>): void => {
    writeBindings(next);
    setCapturing(null);
  };

  const removeChord = (action: ActionId, token: string): void => {
    writeBindings(applyRemove(keybindings.bindings, action, token));
    setChordMenu(null);
  };

  // Dismiss the chord context menu on any outside click / Escape.
  useEffect(() => {
    if (!chordMenu) return;
    const close = (): void => setChordMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setChordMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [chordMenu]);

  return (
    <div className="keybindings-tab" data-testid="keybindings-tab">
      <div className="settings-search">
        <input
          type="text"
          className="settings-search__input"
          data-testid="keybindings-search"
          placeholder="Search key bindings…"
          aria-label="Search key bindings"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {query ? (
          <IconButton
            token="dismiss"
            className="settings-search__clear"
            testId="keybindings-search-clear"
            title="Clear search"
            onClick={clearSearch}
          />
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="settings-search__empty" data-testid="keybindings-search-empty">
          No key bindings match “{query}”.
        </p>
      ) : null}

      {groups.map(({ group, items }) => (
        <section className="settings-group" key={group} data-testid={`keybindings-group-${group}`}>
          <h3 className="settings-group__title">{group}</h3>
          {items.map((d) => {
            const action = d.key as ActionId;
            const chords = keybindings.bindings[d.key] ?? [];
            return (
              <div
                className="settings-row keybinding-row"
                key={d.key}
                data-testid={`binding-${d.key}`}
                onDoubleClick={() => setCapturing({ action, label: d.label })}
                title="Double-click to add a binding"
              >
                <div className="settings-row__meta">
                  <label className="settings-row__label">
                    {d.label}
                    {/**
                     * WHERE this command's chord is live (016, FR-017b0).
                     *
                     * This is the only thing that explains why `Ctrl+X` appears twice in this list
                     * without being a mistake: one cuts a LINE in an editor, the other cuts a FILE
                     * in the tree, and they can never both fire. Without it a user sees a duplicate,
                     * concludes something is broken, and "fixes" it by rebinding one of the two —
                     * breaking something that worked perfectly.
                     */}
                    <span className="keybinding-scopes" data-testid={`binding-${d.key}-scope`}>
                      {scopeNames(COMMAND_SCOPES[action]).map((scope) => (
                        <span className="keybinding-scope" key={scope}>
                          {scope}
                        </span>
                      ))}
                    </span>
                  </label>
                  <p className="settings-row__desc">{d.description}</p>
                </div>
                <div className="settings-row__control">
                  <span className="keybinding-chord" data-testid={`binding-${d.key}-chord`}>
                    {chords.length ? (
                      chords.map((c, i) => (
                        // ONE box per binding, holding the chord AND its remove control. It used
                        // to be a box inside a box — a <kbd> border nested in a pill border — so
                        // three chords read as six objects (FR-019a). The pills wrap, because the
                        // preferences window is resizable down to a small size and an unwrapping
                        // row squashes its chords into illegibility (FR-019).
                        <span
                          className="kb-pill"
                          key={c}
                          data-testid={`binding-${d.key}-pill-${i}`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setChordMenu({ action, token: c, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <span className="kb-pill__chord">{c}</span>
                          <IconButton
                            token="destroy"
                            className="kb-pill__x"
                            testId={`binding-${d.key}-remove-${i}`}
                            title={`Remove ${c}`}
                            onClick={() => removeChord(action, c)}
                          />
                        </span>
                      ))
                    ) : (
                      <em className="keybinding-chord__unbound">unbound</em>
                    )}
                  </span>
                </div>
                <RowActions
                  kind="binding"
                  itemKey={d.key}
                  label={d.label}
                  overridden={isBindingOverridden(keybindings, d.key, SHIPPED)}
                  changed={bindingDiffersFromEntry(keybindings, entry, d.key)}
                  // Every action is clearable — unbound is a valid state for ALL of them, so
                  // unlike a setting this needs no declaration (FR-016). The only thing that
                  // disables the affordance is the action already being unbound.
                  clearable={chords.length > 0}
                  onReset={() => {
                    // See settings-tab: neither a missing bridge nor a throw may be silent.
                    void Promise.resolve(window.throng?.config?.resetBinding?.(d.key)).then(
                      (r) => report(`Resetting ${d.label}`, r),
                      () => report(`Resetting ${d.label}`, undefined),
                    );
                  }}
                  onRevert={() =>
                    writeBindings({ ...keybindings.bindings, [d.key]: entry.bindings[d.key] ?? [] })
                  }
                  onClear={() => writeBindings({ ...keybindings.bindings, [d.key]: [] })}
                />
              </div>
            );
          })}
        </section>
      ))}

      {chordMenu ? (
        <div
          className="kb-ctx-menu"
          data-testid="binding-context-menu"
          role="menu"
          style={{ left: chordMenu.x, top: chordMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="kb-ctx-menu__item"
            data-testid="binding-context-remove"
            onClick={() => removeChord(chordMenu.action, chordMenu.token)}
          >
            Remove “{chordMenu.token}”
          </button>
        </div>
      ) : null}

      {capturing ? (
        <CaptureModal
          action={capturing.action}
          label={capturing.label}
          bindings={keybindings.bindings}
          onApply={applyBindings}
          onClose={() => setCapturing(null)}
        />
      ) : null}
    </div>
  );
}
