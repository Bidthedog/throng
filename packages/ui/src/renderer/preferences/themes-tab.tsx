import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  THEME_METADATA,
  activateTheme,
  getAtPath,
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

/**
 * The Themes tab (feature 007, US4 — FR-035/036/036a/037/038). A theme selector
 * (select = activate, so edits preview live app-wide), rename (reject collision),
 * delete (single confirm), and restore-defaults sit above grouped token controls
 * (colour / font / size / enum) and the icon section. Editing a token writes the
 * selected theme's file via the immediate-apply path. Non-icon groups render from
 * THEME_METADATA; the Icons group is the dedicated icon section.
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

export function ThemesTab(): ReactElement {
  const settings = useAppSettings();
  const activeTheme = useActiveTheme();
  const activeName = settings.appearance.theme;

  const applySettings = useMemo(() => createApplyClient({ kind: 'settings' }), []);
  const groups = useMemo(groupNonIconDescriptors, []);

  const [themes, setThemes] = useState<string[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [renameValue, setRenameValue] = useState(activeName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refreshThemes = (): void => {
    void window.throng?.config?.listThemes?.().then(setThemes).catch(() => {});
  };
  useEffect(refreshThemes, []);
  useEffect(() => {
    void window.throng?.config?.listFonts?.().then(setFonts).catch(() => {});
  }, []);
  useEffect(() => {
    setRenameValue(activeName);
    setRenameError(null);
    setConfirmingDelete(false);
  }, [activeName]);

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
  // write (rather than flooding the file + watcher). Always targets the currently
  // active theme file.
  const writeTheme = useMemo(
    () =>
      debounce((next: Theme) => {
        void writeConfig({ kind: 'theme', name: activeNameRef.current }, JSON.stringify(next));
      }, 150),
    [],
  );
  useEffect(() => () => writeTheme.flush(), [writeTheme]);

  /** Update the optimistic ref and schedule the (debounced) theme-file write. */
  const applyTheme = (next: Theme): void => {
    themeRef.current = next;
    writeTheme(next);
  };

  // select = activate (FR-035): switching the selector activates that theme.
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

  const doRename = async (): Promise<void> => {
    const to = renameValue.trim();
    const res = await window.throng?.config?.renameTheme?.(activeName, to);
    if (res && !res.ok) {
      setRenameError(res.error === 'exists' ? 'A theme with that name already exists.' : 'Invalid name.');
      return;
    }
    setRenameError(null);
    void applySettings.applyNow(activateTheme(settings, to)); // follow the rename
    refreshThemes();
  };

  const doDelete = async (): Promise<void> => {
    await window.throng?.config?.deleteTheme?.(activeName);
    // Fall back to a still-present theme (or throng) so the UI never renders unstyled.
    const remaining = themes.filter((t) => t !== activeName);
    void applySettings.applyNow(activateTheme(settings, remaining[0] ?? 'throng'));
    setConfirmingDelete(false);
    refreshThemes();
  };

  const doRestore = async (): Promise<void> => {
    await window.throng?.config?.restoreDefaultThemes?.();
    refreshThemes();
  };

  return (
    <div className="themes-tab" data-testid="themes-tab">
      <div className="themes-toolbar">
        <label className="themes-toolbar__field">
          <span>Theme</span>
          <select
            className="ctl ctl--select"
            data-testid="theme-select"
            value={activeName}
            onChange={(e) => selectTheme(e.target.value)}
          >
            {(themes.includes(activeName) ? themes : [activeName, ...themes]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="themes-toolbar__field">
          <span>Name</span>
          <input
            className="ctl__input"
            data-testid="theme-rename-input"
            value={renameValue}
            onChange={(e) => {
              setRenameValue(e.target.value);
              setRenameError(null);
            }}
          />
          <button type="button" className="prefs-toolbtn" data-testid="theme-rename-apply" onClick={() => void doRename()}>
            Rename
          </button>
        </label>

        <button type="button" className="prefs-toolbtn" data-testid="theme-delete" onClick={() => setConfirmingDelete(true)}>
          Delete
        </button>
        <button type="button" className="prefs-toolbtn" data-testid="theme-restore" onClick={() => void doRestore()}>
          Restore defaults
        </button>
      </div>

      {renameError ? (
        <p className="ctl__error" data-testid="theme-rename-error">
          {renameError}
        </p>
      ) : null}

      {confirmingDelete ? (
        <div className="themes-confirm" data-testid="theme-delete-confirm">
          <span>Delete “{activeName}”?</span>
          <button type="button" className="prefs-toolbtn" data-testid="theme-delete-confirm-yes" onClick={() => void doDelete()}>
            Delete
          </button>
          <button type="button" className="prefs-toolbtn" data-testid="theme-delete-confirm-no" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </div>
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
