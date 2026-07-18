import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  THEME_METADATA,
  activateTheme,
  buildShippedDefaults,
  classifyThemes,
  cloneName,
  emptyValueFor,
  filterFields,
  getAtPath,
  isThemeTokenOverridden,
  matchesQuery,
  reservedThemeNames,
  setAtPath,
  themeTokenDiffersFromEntry,
  type FieldDescriptor,
  type IconValue,
  type Theme,
} from '@throng/core';
import { useActiveTheme, useAppSettings } from '../config/config-store.js';
import { writeConfig, scheduleWrite, debounce } from '../config/write-config.js';
import { createApplyClient } from './apply-client.js';
import { ThemeTokenControl } from './pickers.js';
import { RowActions } from './row-actions.js';
import { IconSection } from './icon-section.js';
import { IconButton } from '../common/icon-button.js';
import { ROW_ACTION_TOKENS } from './row-action-tokens.js';
import { useConfirm } from '../confirm-dialog.js';
import { useNotify } from '../common/notification.js';
import { NameDialog } from './name-dialog.js';

/**
 * The Themes tab (feature 007 base + feature 014 restore/create controls).
 *
 * A compact toolbar: one **dropdown** naming the theme, then the actions that apply to the
 * **currently selected** theme (Restore, Clone, Rename, Delete), then a separator and **Restore
 * All**, which is set apart because it acts on every built-in rather than the selection — and
 * carries its own icon so the two restores never read as the same action.
 *
 * A built-in the user DELETES simply disappears from the picker (FR-005a); it is recovered only by
 * Restore All. Selecting a theme activates it (select = activate, as it always has).
 *
 * Every action control is a themeable icon carrying a hover title (constitution v3.12.0); the only
 * text is the dialogs' decision buttons and the name field (the stated dialog exception). Actions
 * report only FAILURES — a successful restore/clone is self-evident from the editor below, so it
 * raises no banner.
 *
 * Below the toolbar, the grouped token controls + icon section edit the ACTIVE theme via the
 * immediate-apply path (unchanged from 007).
 */
/** How long the typeahead waits after the last keystroke before filtering (FR-021). */
const SEARCH_DEBOUNCE_MS = 150;

/** The shipped record, once — the factory baseline a per-token Reset returns a built-in to (#76). */
const SHIPPED = buildShippedDefaults();

/** The theme's editable token descriptors — icons excluded, the icon section owns those. */
const THEME_TOKEN_FIELDS: readonly FieldDescriptor[] = THEME_METADATA.filter(
  (d) => d.control !== 'icon',
);

/** The icon tokens — same registry, same descriptors, filtered by the same typeahead (FR-021). */
const THEME_ICON_FIELDS: readonly FieldDescriptor[] = THEME_METADATA.filter(
  (d) => d.control === 'icon',
);

/** The icon-pack selector is a Theme property, not a token, so it needs its own searchable text. */
const ICON_PACK_FIELD = {
  key: 'iconPack',
  label: 'Icon pack',
  description: 'Map all icon tokens at once; override individual tokens below.',
};

/**
 * Tokens the generic Colours group must NOT render, because they have a home of their own.
 *
 * `iconColour` is edited BESIDE THE ICON-PACK SELECTOR (FR-027) — which is where the user is
 * standing when the icons look wrong, and is why the requirement puts it there. But it is also a
 * real colour token with a derived descriptor (that is what makes it editable at all, and what
 * satisfies the constitution's configuration-editor-completeness rule), so the generic loop would
 * otherwise render a SECOND control for it in the Colours group.
 *
 * Two controls for one value is not a cosmetic problem: edit one and the other silently disagrees
 * until the round-trip lands, and neither tells you the other exists.
 */
const RENDERED_ELSEWHERE = new Set(['colours.iconColour']);

function groupNonIconDescriptors(items: readonly FieldDescriptor[]): {
  group: string;
  items: FieldDescriptor[];
}[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();
  for (const d of items) {
    if (RENDERED_ELSEWHERE.has(d.key)) continue;
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

/* The `Pending` modal state is gone: the three confirmations are `await`ed on the shared model now,
   so there is no local "which dialog is open" to track. */

type NameFlow = { mode: 'clone' | 'rename'; source: string } | null;

export function ThemesTab(): ReactElement {
  const settings = useAppSettings();
  const activeTheme = useActiveTheme();
  const activeName = settings.appearance.theme;

  const applySettings = useMemo(() => createApplyClient({ kind: 'settings' }), []);
  // FR-021: the third and last tab to get the typeahead — and the one that needs it most, with
  // several hundred token rows. Same shared `filterFields` the other two use; a theme value is
  // matched on its label, its description and its current value.
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const applySearch = useMemo(() => debounce((q: string) => setApplied(q), SEARCH_DEBOUNCE_MS), []);
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
    () => filterFields(applied, THEME_TOKEN_FIELDS, (d) => getAtPath(activeTheme, d.key)),
    [applied, activeTheme],
  );
  const groups = useMemo(() => groupNonIconDescriptors(matches), [matches]);

  /**
   * The icon section is part of the theme, so it is part of the search (FR-021). It used to sit
   * outside the filtered groups and simply ignore the query — search for "terminal" and you got
   * two matching colour rows and, still, the entire icon grid underneath. A section that ignores
   * the filter is worse than one with no filter, because it looks like a result.
   */
  const iconFilter = useMemo(() => {
    if (!applied) return null; // no search → show the whole section
    const fields = filterFields(applied, THEME_ICON_FIELDS, (d) => getAtPath(activeTheme, d.key));
    return {
      tokens: fields.map((d) => d.key.replace(/^icons\./, '')),
      packRowMatches: matchesQuery(applied, ICON_PACK_FIELD, activeTheme.iconPack ?? ''),
    };
  }, [applied, activeTheme]);

  const iconSectionMatches = !iconFilter || iconFilter.tokens.length > 0 || iconFilter.packRowMatches;
  // Reserved built-in names come straight from the pure 010 record — no IPC needed,
  // so a DELETED built-in's name is still reserved (FR-007).
  const reserved = useMemo(() => reservedThemeNames(), []);

  const [themes, setThemes] = useState<string[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [nameFlow, setNameFlow] = useState<NameFlow>(null);

  const confirm = useConfirm();
  const { notify } = useNotify();

  /**
   * Only FAILURES are surfaced. A successful restore / clone / rename is immediately visible in the
   * editor below, so announcing it in a banner is noise — but a restore that silently did nothing
   * (a locked file, say) must never look like it worked (SC-007).
   *
   * 018: through THE notification model. This surface used to own the app's FIFTH dismissable error
   * strip — the one the specification's count of four missed — whose colour fell through a variable
   * defined nowhere to `--accent`, rendering a failure in the success colour.
   */
  const setError = (message: string): void =>
    notify({ severity: 'error', message, testId: 'theme-notice-error' });

  /**
   * The three confirmations, on the SHARED model — which this window can finally reach.
   *
   * The rival dialog they used to open existed for exactly one reason: `useConfirm()` throws outside
   * a provider, and the preferences window never mounted one. Its identifiers are preserved.
   */
  const askOnThemes = (
    title: string,
    message: string,
    confirmLabel: string,
    // The DELETE confirmation carried its own identifier, distinct from the other two, and a suite
    // reads it. Collapsing them would have been a rename, and FR-053 says identifiers are preserved.
    dialogTestId = 'theme-confirm-dialog',
  ): Promise<boolean> =>
    confirm({
      title,
      message,
      confirmLabel,
      testIds: { dialog: dialogTestId },
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'theme-confirm-no' },
        { label: confirmLabel, value: 'accept', danger: true, testId: 'theme-confirm-yes' },
      ],
    });

  const askRestoreAll = (): void => {
    void askOnThemes(
      'Restore all themes to default?',
      'Every built-in theme returns to its shipped values and any deleted built-in is recreated. Your edits to built-in themes will be lost. Custom themes are not touched.',
      'Restore All',
    ).then((ok) => {
      if (ok) void doRestoreAll();
    });
  };

  const askRestoreTheme = (name: string): void => {
    void askOnThemes(
      `Restore “${name}” to default?`,
      'This theme returns to its shipped values. Your edits to it will be lost. No other theme is affected.',
      'Restore',
    ).then((ok) => {
      if (ok) void doRestoreTheme(name);
    });
  };

  /**
   * REVERT the whole theme: back to exactly what it was when this window opened.
   *
   * Distinct from Restore, and the distinction is the point. Restore asks "what does Throng SHIP?" —
   * so it exists only for a built-in, and it throws away work you may have done deliberately months
   * ago. Revert asks "what did I OPEN this window with?" — so it exists for every theme, custom ones
   * included, and it undoes only this sitting. Every row already offered both; the theme as a WHOLE
   * offered only Restore, so a custom theme you had just made a mess of had no way back at all short
   * of undoing each token by hand.
   */
  const askRevertTheme = (name: string): void => {
    void askOnThemes(
      `Revert “${name}” to how it was?`,
      'Every change you have made to this theme since opening Preferences is undone. Changes you made in an earlier session are kept — this is not a restore to the shipped default.',
      'Revert',
    ).then((ok) => {
      if (ok) applyTheme(entryThemes.current[activeNameRef.current] ?? themeRef.current);
    });
  };

  const askDelete = (name: string): void => {
    void askOnThemes(
      `Delete “${name}”?`,
      reserved.includes(name)
        ? 'This is a built-in theme. It will be removed from the list; the only way to bring it back is “Restore all themes to default”.'
        : 'This custom theme has no shipped default, so it cannot be restored afterwards.',
      'Delete',
      'theme-delete-confirm',
    ).then((ok) => {
      if (ok) void doDelete(name);
    });
  };

  const refreshThemes = (): void => {
    void window.throng?.config?.listThemes?.().then(setThemes).catch(() => {});
  };
  useEffect(refreshThemes, []);
  useEffect(() => {
    void window.throng?.config?.listFonts?.().then(setFonts).catch(() => {});
  }, []);

  // The PRESENT themes only, tagged built-in | custom (pure, unit-tested in @throng/core). A built-in
  // the user deleted is not listed at all — Restore All is the only way back (FR-005a).
  const rows = useMemo(() => classifyThemes(themes, reserved), [themes, reserved]);
  // The toolbar acts on the ACTIVE theme (selecting a theme activates it). The dropdown's value is
  // bound to it rather than to the click, because activation round-trips through the config watcher
  // and the token editor below edits the *active* theme — a picker that jumped ahead of activation
  // would show one theme while the controls beneath it still edited the previous one.
  const target = useMemo(() => rows.find((r) => r.name === activeName) ?? null, [rows, activeName]);
  const targetName = target?.name ?? activeName;
  const isBuiltIn = target?.kind === 'built-in';
  const isCustom = target?.kind === 'custom';

  // Optimistic latest theme: rapid edits (e.g. select a pack then override a
  // token, or drag the colour swatch) compound off this ref within one debounce
  // window instead of being lost to a stale render. It RESYNCS to `activeTheme`
  // whenever the active theme's content changes for any reason — a reset, an
  // external/JSON-tab edit, our own write round-tripping, or a theme switch — so
  // edits made after a Reset build on the reset value, not a stale buffer.
  const activeNameRef = useRef(activeName);
  activeNameRef.current = activeName;
  const themeRef = useRef<Theme>(activeTheme);
  useEffect(() => {
    themeRef.current = activeTheme;
  }, [activeTheme]);

  /**
   * Update the optimistic ref and schedule the (debounced) theme-file write.
   *
   * Debounced so a colour drag's many change events coalesce into one atomic write (rather than
   * flooding the file + watcher), and scheduled through the write MODULE (019 FR-010, C25) so a
   * close can settle it — the flush this tab used to do on unmount never ran on the path that
   * loses the edit, because a closing window is DESTROYED and unmounts nothing.
   *
   * The TARGET THEME NAME is still captured when the edit is made, not when the debounce fires:
   * activating another theme (or Clone, which activates the new theme) within the debounce
   * window would otherwise land theme A's pending document in theme B's file. That guarantee
   * (018 FR-023) is now ENFORCED by the module's per-id keying rather than carried by a payload
   * convention — theme A's pending write is keyed to A and B's to B, so neither displaces the
   * other.
   */
  const applyTheme = (next: Theme): void => {
    themeRef.current = next;
    const name = activeNameRef.current;
    scheduleWrite({ kind: 'theme', name }, () => JSON.stringify(next), 150);
  };

  /** Selecting from the dropdown activates that theme (select = activate, FR-035). */
  const selectTheme = (name: string): void => {
    void applySettings.applyNow(activateTheme(settings, name));
  };

  const commitToken = (key: string, value: unknown): void => {
    applyTheme(setAtPath(themeRef.current, key, value) as Theme);
  };

  /**
   * The per-token Reset / Revert baselines (issue #76).
   *
   * A theme file IS the theme — no override layer — so both are ordinary token edits through
   * `commitToken`: Reset writes the shipped leaf, Revert writes the on-entry leaf. Neither needs a
   * restore IPC, which is what keeps a per-token reset clear of 015 FR-013's duplicate-write rule:
   * it is a *different write scope* from 014's whole-theme restore and takes the editor's own path.
   *
   * Reset applies only to a **built-in** — a custom/cloned theme has no factory value to return to,
   * so `shippedTheme` is undefined and the Reset affordance is DECLINED (not merely disabled).
   *
   * Revert's baseline is captured **per theme, the first time this session activates it** — the
   * value it had when the window opened. Lazy because the user may switch between (and edit) several
   * themes without leaving the window; each keeps its own on-entry value, so reverting one never
   * restores another's.
   */
  const shippedTheme: Theme | undefined = isBuiltIn ? SHIPPED.themes[targetName] : undefined;
  const entryThemes = useRef<Record<string, Theme>>({});
  if (!Object.prototype.hasOwnProperty.call(entryThemes.current, activeName)) {
    entryThemes.current[activeName] = activeTheme;
  }
  const entryTheme = entryThemes.current[activeName] ?? activeTheme;

  // Has THIS theme been touched since the window opened? Asked with the same predicate each row uses,
  // so the toolbar's Revert appears exactly when at least one row's Revert does — one rule, so the two
  // can never disagree about whether there is anything to undo.
  const dirtyTheme = useMemo(
    () => THEME_METADATA.some((d) => themeTokenDiffersFromEntry(activeTheme, entryTheme, d.key)),
    [activeTheme, entryTheme],
  );

  /**
   * Offer a clear only where the field declares empty a valid value AND the value is not already
   * empty — clearing an empty value is a no-op, and a no-op affordance is noise (FR-016a).
   */
  const canClear = (d: FieldDescriptor): boolean => {
    if (!d.clearable) return false;
    const value = getAtPath(activeTheme, d.key);
    return Array.isArray(value) ? value.length > 0 : value !== '';
  };

  const setIconPack = (pack: string | undefined): void => {
    const next: Theme = { ...themeRef.current };
    if (pack) next.iconPack = pack;
    else delete next.iconPack;
    applyTheme(next);
  };

  const overrideIcon = (token: string, raw: string): void => {
    const overrides: Record<string, IconValue> = { ...(themeRef.current.iconOverrides ?? {}) };
    const trimmed = raw.trim();
    if (trimmed.length === 0) delete overrides[token];
    else overrides[token] = /\.(svg|png)$/i.test(trimmed) ? { image: trimmed } : { glyph: trimmed };
    applyTheme({ ...themeRef.current, iconOverrides: overrides });
  };

  /**
   * FR-001/002/003: the real Restore All — 010's atomic restore-all-built-in-themes.
   * A MISSING bridge method resolves to `undefined`; that is a failure, not a success — reporting
   * "restored" when nothing happened would be an untruthful result (SC-007).
   */
  const doRestoreAll = async (): Promise<void> => {
    const res = await window.throng?.config?.restoreAllThemes?.();
    if (!res || !res.ok) {
      const why = res ? res.failedPath || res.error || 'unknown error' : 'unavailable';
      setError(`Restore failed: ${why}. No theme was changed.`);
    }
    refreshThemes();
  };

  /** FR-005: restore the selected built-in to its shipped values. */
  const doRestoreTheme = async (name: string): Promise<void> => {
    const res = await window.throng?.config?.restoreTheme?.(name);
    if (!res || !res.ok) {
      const why = res ? res.failedPath || res.error || 'unknown error' : 'unavailable';
      setError(`Restore failed: ${why}. “${name}” was not changed.`);
    }
    refreshThemes();
  };

  const doDelete = async (name: string): Promise<void> => {
    await window.throng?.config?.deleteTheme?.(name);
    if (name === activeName) {
      // Fall back to a still-present theme (or throng) so the UI never renders unstyled.
      const remaining = themes.filter((t) => t !== name);
      void applySettings.applyNow(activateTheme(settings, remaining[0] ?? 'throng'));
    }
    refreshThemes();
  };

  /**
   * FR-006: Clone is the sole creation path. Copies the SOURCE theme's document to the new name
   * (retargeting its `name` field) and activates it.
   *
   * If the source cannot be read or is malformed we ABORT with an error rather than falling back
   * to the active theme: silently cloning a *different* theme than the one selected, while
   * reporting success, is worse than doing nothing. The write result is checked for the same
   * reason — activating a theme whose file was never written leaves the app unstyled (SC-007).
   */
  const doClone = async (source: string, newName: string): Promise<void> => {
    const raw = await window.throng?.config?.readRaw?.({ kind: 'theme', name: source });
    if (!raw || raw.trim().length === 0) {
      setError(`Could not read “${source}” — nothing was created.`);
      return;
    }
    let base: Theme;
    try {
      base = JSON.parse(raw) as Theme;
    } catch {
      setError(`“${source}” is not valid JSON — nothing was created.`);
      return;
    }
    const next: Theme = { ...base, name: newName };
    const res = await writeConfig({ kind: 'theme', name: newName }, JSON.stringify(next));
    if (!res.ok) {
      setError(`Could not create “${newName}”: ${res.error}.`);
      refreshThemes();
      return;
    }
    void applySettings.applyNow(activateTheme(settings, newName));
    refreshThemes();
  };

  /** FR-008: rename via the same modal name dialog (007's in-place field is gone). */
  const doRename = async (from: string, to: string): Promise<void> => {
    const res = await window.throng?.config?.renameTheme?.(from, to);
    if (res && !res.ok) {
      setError(res.error === 'exists' ? 'A theme with that name already exists.' : 'Invalid name.');
      return;
    }
    if (from === activeName) void applySettings.applyNow(activateTheme(settings, to)); // follow the rename
    refreshThemes();
  };

  const closeName = (): void => setNameFlow(null);

  return (
    <div className="themes-tab" data-testid="themes-tab">
      <div className="themes-toolbar">
        <label className="themes-toolbar__field">
          <span>Theme</span>
          <select
            className="ctl ctl--select"
            data-testid="theme-select"
            value={targetName}
            onChange={(e) => selectTheme(e.target.value)}
          >
            {rows.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {/* Actions on the SELECTED theme… */}
        <span className="themes-toolbar__actions">
          {/* Undo this sitting's edits — offered for EVERY theme, built-in or custom, and only when
              there is actually something to undo (a no-op affordance is noise, FR-016a). */}
          {dirtyTheme ? (
            <IconButton
              token={ROW_ACTION_TOKENS.revert}
              title={`Revert “${targetName}” to how it was when this window opened`}
              testId="theme-revert"
              onClick={() => askRevertTheme(targetName)}
            />
          ) : null}
          {isBuiltIn ? (
            <IconButton
              token="retry"
              title={`Restore “${targetName}” to default`}
              testId="theme-restore"
              onClick={() => askRestoreTheme(targetName)}
            />
          ) : null}
          <IconButton
            token="add"
            title={`Clone “${targetName}”`}
            testId="theme-clone"
            onClick={() => setNameFlow({ mode: 'clone', source: targetName })}
          />
          {isCustom ? (
            <IconButton
              token="rename"
              title={`Rename “${targetName}”`}
              testId="theme-rename"
              onClick={() => setNameFlow({ mode: 'rename', source: targetName })}
            />
          ) : null}
          <IconButton
            token="destroy"
            title={`Delete “${targetName}”`}
            testId="theme-delete"
            onClick={() => askDelete(targetName)}
          />

          {/*
            …then, set apart, Restore All — it acts on EVERY built-in rather than the selection, so
            it is separated and carries its own icon rather than reusing the per-theme restore glyph.
          */}
          <span className="themes-toolbar__sep" aria-hidden="true" />
          <IconButton
            token="restoreAll"
            title="Restore all themes to default"
            testId="theme-restore-all"
            onClick={askRestoreAll}
          />
        </span>
      </div>

      {/*
       * 018 / FR-051 — the themes surface's RIVAL confirmation dialog and its FIFTH error strip are
       * both gone.
       *
       * The rival dialog existed for exactly one reason: `useConfirm()` throws outside a
       * ConfirmProvider, and the preferences window never mounted one. So this surface could not
       * reach the shared confirmation and had to grow a second, incompatible implementation — built
       * on different CSS, with a different z-index, a different overlay opacity and different
       * buttons. It would never have looked the same beside the one it duplicated.
       *
       * The error strip was the fifth in the app, and the specification's count of four missed it.
       * Its colour came from `--danger`, a variable defined nowhere, so it fell through to
       * `--accent` and rendered a FAILURE IN THE SUCCESS COLOUR — directly contradicting the comment
       * that used to sit above it.
       *
       * Both are the shared models now. Every identifier is preserved.
       */}

      {nameFlow?.mode === 'clone'
        ? (() => {
            const initial = cloneName(nameFlow.source);
            return (
              <NameDialog
                title={`Clone “${nameFlow.source}”`}
                initialValue={initial}
                // Pre-select the trailing "Clone" word so the user types straight over it.
                preselect={{ start: initial.length - 'Clone'.length, end: initial.length }}
                reserved={reserved}
                existing={themes}
                confirmLabel="Create"
                onConfirm={(name) => {
                  const { source } = nameFlow;
                  closeName();
                  void doClone(source, name);
                }}
                onCancel={closeName}
              />
            );
          })()
        : null}

      {nameFlow?.mode === 'rename' ? (
        <NameDialog
          title={`Rename “${nameFlow.source}”`}
          initialValue={nameFlow.source}
          reserved={reserved}
          existing={themes}
          renamingFrom={nameFlow.source}
          confirmLabel="Rename"
          onConfirm={(name) => {
            const { source } = nameFlow;
            closeName();
            void doRename(source, name);
          }}
          onCancel={closeName}
        />
      ) : null}

      <div className="settings-search">
        <input
          type="text"
          className="settings-search__input"
          data-testid="themes-search"
          placeholder="Search theme values…"
          aria-label="Search theme values"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {query ? (
          <IconButton
            token="dismiss"
            className="settings-search__clear"
            testId="themes-search-clear"
            title="Clear search"
            onClick={clearSearch}
          />
        ) : null}
      </div>

      {groups.length === 0 && !iconSectionMatches ? (
        <p className="settings-search__empty" data-testid="themes-search-empty">
          No theme values match “{query}”.
        </p>
      ) : null}

      {groups.map(({ group, items }) => (
        <section className="settings-group" key={group} data-testid={`settings-group-${group}`}>
          <h3 className="settings-group__title">{group}</h3>
          {items.map((d) => (
            <div className="settings-row" key={d.key} data-testid={`theme-row-${d.key}`}>
              <div className="settings-row__meta">
                <label className="settings-row__label">{d.label}</label>
                <p className="settings-row__desc">{d.description}</p>
              </div>
              <div className="settings-row__control">
                <ThemeTokenControl
                  descriptor={d}
                  value={getAtPath(activeTheme, d.key)}
                  fonts={fonts}
                  onCommit={(v) => commitToken(d.key, v)}
                />
              </div>
              {/* Per-token Reset / Revert / Clear (issue #76) — the Themes tab now matches Settings
                  and Key Bindings. All three are ordinary token edits through `commitToken` (Reset →
                  shipped leaf, Revert → on-entry leaf, Clear → empty), so none needs a restore IPC
                  and none duplicates 014's whole-theme restore (a different write scope). Reset is
                  DECLINED on a custom theme, which has no shipped value to return to. */}
              <RowActions
                kind="theme"
                itemKey={d.key}
                label={d.label}
                overridden={isThemeTokenOverridden(activeTheme, shippedTheme, d.key)}
                changed={themeTokenDiffersFromEntry(activeTheme, entryTheme, d.key)}
                clearable={canClear(d)}
                onReset={
                  shippedTheme
                    ? () => commitToken(d.key, getAtPath(shippedTheme, d.key))
                    : undefined
                }
                onRevert={() => commitToken(d.key, getAtPath(entryTheme, d.key))}
                onClear={() => commitToken(d.key, emptyValueFor(d))}
              />
            </div>
          ))}
        </section>
      ))}

      <IconSection
        theme={activeTheme}
        onSetPack={setIconPack}
        onOverride={overrideIcon}
        // An ordinary token edit — the same debounced, theme-captured write path every colour uses,
        // so the icon colour cannot misfile itself into another theme any more than a colour can.
        onSetIconColour={(hex) => commitToken('colours.iconColour', hex)}
        filter={iconFilter}
      />
    </div>
  );
}
