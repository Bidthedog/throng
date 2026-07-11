# Contracts: Folder Picker & Settings

## UI-main IPC — `throng:pickFolder` (extended, backward-compatible)

Current: `pickFolder(): Promise<string | null>` — opens the OS folder dialog with no `defaultPath`.

Extended:

```
pickFolder(opts?: { defaultPath?: string }): Promise<string | null>
```

- When `opts.defaultPath` is a string that resolves to an existing directory, the OS dialog opens there.
- When it is absent, empty, non-existent, or on a disconnected/inaccessible drive, the handler falls
  back to the OS home directory (`app.getPath('home')`). (FR-043)
- Existence/drive validation happens in UI-main (Principle II — OS-specific checks stay in main).
- Return value unchanged: the chosen absolute path, or `null` if cancelled.

The preload/bridge type for `window.throng.pickFolder` gains the optional `opts` parameter. Existing
callers passing no argument keep working.

## Renderer — new-project flow (project creation)

1. On "+ New", read `settings.newProject` and compute the candidate via `resolveStartingFolder`.
2. Call `pickFolder({ defaultPath: candidate })` (auto-pop, existing behaviour).
3. On a successful project create from folder `F`, write `newProject.lastProjectFolder = F` through
   the existing `config.write` path (immediate-apply). (FR-040)

## Settings — new descriptors (`settings-metadata.ts`)

- `newProject.startingFolder` — `select`, `['profile','lastViewed','override']`, group "New Project",
  label "New project folder starts at".
- `newProject.overridePath` — `folder`, group "New Project", label "Override start folder".
- `newProject.lastProjectFolder` — NO descriptor; added to `SETTINGS_INTERNAL_KEYS`.
- Re-aligned labels (keys unchanged): `confirmations.destroyProject` -> "Remove a project";
  `confirmations.destroySubWorkspace` -> "Destroy a sub-workspace".

The `settings-metadata.test.ts` completeness audit MUST stay green with these changes.

## Settings form rendering (HANDOFF to 015 — `preferences/**`, not owned here)

- `preferences/form-controls.tsx` adds `case 'folder'` rendering the shared folder-picker component
  (browse-only, no auto-pop). (FR-042a settings side)
- `preferences/settings-tab.tsx` flags an unresolvable override using `isOverrideResolvable`. (FR-044)

Until 015 lands these, the override renders via the form's existing default as an editable text field
(typeable/pasteable) without the browse icon or the flag. Do NOT touch `preferences/**` in 011.

## Shared component contract (`renderer/common/folder-picker.tsx`)

```
FolderPicker(props: {
  value: string
  onChange: (path: string) => void
  autoOpenOnMount?: boolean     // project creation: true; settings: false/absent
  title?: string                // browse-icon hover title
}): ReactElement
```

- Editable text input bound to `value`/`onChange` (type/paste/edit allowed).
- Themeable browse icon (hover title, theme-token colours) -> `pickFolder({ defaultPath: value })`.
- Never opens the dialog on its own unless `autoOpenOnMount` is true.
