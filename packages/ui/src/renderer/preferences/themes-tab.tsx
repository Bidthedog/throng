import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  THEME_METADATA,
  activateTheme,
  classifyThemes,
  cloneName,
  getAtPath,
  reservedThemeNames,
  setAtPath,
  type FieldDescriptor,
  type IconValue,
  type Theme,
} from '@throng/core';
import { useActiveTheme, useAppSettings } from '../config/config-store.js';
import { writeConfig, debounce } from '../config/write-config.js';
import { createApplyClient } from './apply-client.js';
import { ThemeTokenControl } from './pickers.js';
import { IconSection } from './icon-section.js';
import { IconButton } from '../common/icon-button.js';
import { DismissButton } from '../common/dismiss-button.js';
import { ConfirmDialog } from './confirm-dialog.js';
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
function groupNonIconDescriptors(): { group: string; items: FieldDescriptor[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();
  for (const d of THEME_METADATA) {
    if (d.control === 'icon') continue; // the icon section handles these
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

/** Which modal (if any) is open. Only one at a time. */
type Pending =
  | { kind: 'restore-all' }
  | { kind: 'restore-theme'; name: string }
  | { kind: 'delete'; name: string }
  | null;

type NameFlow = { mode: 'clone' | 'rename'; source: string } | null;

export function ThemesTab(): ReactElement {
  const settings = useAppSettings();
  const activeTheme = useActiveTheme();
  const activeName = settings.appearance.theme;

  const applySettings = useMemo(() => createApplyClient({ kind: 'settings' }), []);
  const groups = useMemo(groupNonIconDescriptors, []);
  // Reserved built-in names come straight from the pure 010 record — no IPC needed,
  // so a DELETED built-in's name is still reserved (FR-007).
  const reserved = useMemo(() => reservedThemeNames(), []);

  const [themes, setThemes] = useState<string[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [nameFlow, setNameFlow] = useState<NameFlow>(null);
  /**
   * Only FAILURES are surfaced. A successful restore / clone / rename is immediately visible in the
   * editor below, so announcing it in a banner is noise — but a restore that silently did nothing
   * (a locked file, say) must never look like it worked (SC-007).
   */
  const [error, setError] = useState<string | null>(null);

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

  // Debounced write so a colour drag's many change events coalesce into one atomic
  // write (rather than flooding the file + watcher). The TARGET THEME NAME is captured
  // when the edit is made, not when the debounce fires: activating another theme (or
  // Clone, which activates the new theme) within the debounce window would otherwise
  // land theme A's pending document in theme B's file.
  const writeTheme = useMemo(
    () =>
      debounce((doc: { name: string; theme: Theme }) => {
        void writeConfig({ kind: 'theme', name: doc.name }, JSON.stringify(doc.theme));
      }, 150),
    [],
  );
  useEffect(() => () => writeTheme.flush(), [writeTheme]);

  /** Update the optimistic ref and schedule the (debounced) theme-file write. */
  const applyTheme = (next: Theme): void => {
    themeRef.current = next;
    writeTheme({ name: activeNameRef.current, theme: next });
  };

  /** Selecting from the dropdown activates that theme (select = activate, FR-035). */
  const selectTheme = (name: string): void => {
    void applySettings.applyNow(activateTheme(settings, name));
  };

  const commitToken = (key: string, value: unknown): void => {
    applyTheme(setAtPath(themeRef.current, key, value) as Theme);
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
  const closePending = (): void => setPending(null);

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
          {isBuiltIn ? (
            <IconButton
              token="retry"
              title={`Restore “${targetName}” to default`}
              testId="theme-restore"
              onClick={() => setPending({ kind: 'restore-theme', name: targetName })}
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
            onClick={() => setPending({ kind: 'delete', name: targetName })}
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
            onClick={() => setPending({ kind: 'restore-all' })}
          />
        </span>
      </div>

      {/* Only failures are announced — a success is visible in the editor below (no banner). */}
      {error ? (
        <p className="themes-notice themes-notice--error" data-testid="theme-notice-error">
          <span>{error}</span>
          <DismissButton
            onDismiss={() => setError(null)}
            className="themes-notice__dismiss"
            testId="theme-notice-dismiss"
          />
        </p>
      ) : null}

      {pending?.kind === 'restore-all' ? (
        <ConfirmDialog
          title="Restore all themes to default?"
          message="Every built-in theme returns to its shipped values and any deleted built-in is recreated. Your edits to built-in themes will be lost. Custom themes are not touched."
          confirmLabel="Restore All"
          onConfirm={() => {
            closePending();
            void doRestoreAll();
          }}
          onCancel={closePending}
        />
      ) : null}

      {pending?.kind === 'restore-theme' ? (
        <ConfirmDialog
          title={`Restore “${pending.name}” to default?`}
          message="This theme returns to its shipped values. Your edits to it will be lost. No other theme is affected."
          confirmLabel="Restore"
          onConfirm={() => {
            const { name } = pending;
            closePending();
            void doRestoreTheme(name);
          }}
          onCancel={closePending}
        />
      ) : null}

      {pending?.kind === 'delete' ? (
        <ConfirmDialog
          title={`Delete “${pending.name}”?`}
          message={
            reserved.includes(pending.name)
              ? 'This is a built-in theme. It will be removed from the list; the only way to bring it back is “Restore all themes to default”.'
              : 'This custom theme has no shipped default, so it cannot be restored afterwards.'
          }
          confirmLabel="Delete"
          onConfirm={() => {
            const { name } = pending;
            closePending();
            void doDelete(name);
          }}
          onCancel={closePending}
          testId="theme-delete-confirm"
        />
      ) : null}

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
            </div>
          ))}
        </section>
      ))}

      <IconSection theme={activeTheme} onSetPack={setIconPack} onOverride={overrideIcon} />
    </div>
  );
}
