/**
 * Settings editor metadata (feature 007, FR-025a/026–029). One
 * {@link FieldDescriptor} per configurable leaf of {@link AppSettings}, grouped
 * into labelled sections, driving the generic Settings form. The completeness
 * test (`settings-metadata.test.ts`) asserts every leaf except the internal
 * `version` marker has exactly one descriptor (FR-047). Pure; zero OS/DOM.
 */
import { DEFAULT_APP_SETTINGS } from './app-settings.js';
import { leavesOfDeclared, type FieldDescriptor, type MetadataRegistry } from './metadata.js';

/** Leaves that are internal bookkeeping, not user-configurable settings. */
export const SETTINGS_INTERNAL_KEYS: readonly string[] = [
  'version',
  // The folder last chosen for a project — machine bookkeeping that drives the
  // "Last Viewed" picker option (011), not a hand-tuned setting.
  'newProject.lastProjectFolder',
  // The three terminal-flavour settings, HIDDEN for v1.0.0 pending #67's proper
  // implementation in vNext. #67 (make flavour editing work through the visual editor)
  // renders badly and does not work, so its controls must not ship. This is a HIDE, not a
  // revert: the settings still parse and take effect via a hand-edited settings.json — only
  // the Settings UI controls are withheld. Their descriptors are kept verbatim in
  // HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS below and re-exposed in vNext by spreading them back
  // into SETTINGS_METADATA and deleting these three lines.
  //
  // Marking them internal is what keeps the completeness rule (FR-047) satisfied: an internal
  // leaf is excluded from the configurable set, so it neither demands a descriptor (no
  // "missing") nor may carry one in the rendered registry (no "unknown") — exactly the
  // treatment `newProject.lastProjectFolder` above already receives.
  'terminals.flavours',
  'terminals.disabledBuiltins',
  'terminals.defaultParams',
];

/**
 * The configurable settings leaves (every leaf minus the internal keys).
 *
 * A key a descriptor declares to be a `map` is ONE leaf, not one per entry (016, F5) — otherwise
 * `editor.indentByLanguage`, which ships non-empty, would demand a descriptor per language and
 * fail the completeness test outright.
 */
export function settingsLeaves(): string[] {
  return leavesOfDeclared(DEFAULT_APP_SETTINGS, SETTINGS_METADATA).filter(
    (k) => !SETTINGS_INTERNAL_KEYS.includes(k),
  );
}

const CONFIRM_VALUES = ['none', 'single', 'double'] as const;
const DRAG_MODIFIERS = ['ctrl', 'shift', 'alt'] as const;

function confirmDescriptor(key: string, label: string, description: string): FieldDescriptor {
  return { key, label, description, group: 'Confirmations', control: 'select', allowedValues: CONFIRM_VALUES };
}

export const SETTINGS_METADATA: MetadataRegistry = [
  // Appearance
  {
    key: 'appearance.theme',
    label: 'Theme',
    description: 'The active appearance theme applied across the whole app.',
    group: 'Appearance',
    control: 'select', // options are the themes on disk (populated at runtime)
  },

  // Confirmations
  confirmDescriptor(
    'confirmations.destroyProject',
    'Remove a project',
    'How many confirmations before a project is removed (unregistered; no files are deleted).',
  ),
  confirmDescriptor(
    'confirmations.destroyTab',
    'Close a tab',
    'How many confirmations before a tab (with its panels) is closed.',
  ),
  confirmDescriptor(
    'confirmations.destroyPanel',
    'Destroy a panel',
    'How many confirmations before a panel is destroyed.',
  ),
  confirmDescriptor(
    'confirmations.destroySubWorkspace',
    'Destroy a sub-workspace',
    'How many confirmations before a sub-workspace is destroyed.',
  ),

  // Panes
  {
    key: 'panes.projects.maxWidth',
    label: 'Projects pane max width',
    description: 'The widest (px) the Projects sidebar pane can be dragged.',
    group: 'Panes',
    control: 'slider',
    min: 200,
    max: 1200,
    step: 10,
  },
  {
    key: 'panes.fileExplorer.maxWidth',
    label: 'File Explorer pane max width',
    description: 'The widest (px) the Files & Folders pane can be dragged.',
    group: 'Panes',
    control: 'slider',
    min: 200,
    max: 1200,
    step: 10,
  },

  // Behaviour
  {
    key: 'behaviour.tabHoverActivateMs',
    label: 'Tab hover-activate delay',
    description: 'Dwell time (ms) hovering a tab during a panel drag before it activates.',
    group: 'Behaviour',
    control: 'slider',
    min: 0,
    max: 5000,
    step: 50,
  },
  {
    key: 'behaviour.submenuHoverMs',
    label: 'Submenu hover delay',
    description: 'Dwell time (ms) before a context-menu submenu opens.',
    group: 'Behaviour',
    control: 'slider',
    min: 0,
    max: 2000,
    step: 25,
  },

  // File Explorer
  //
  // 019 US5 / #95 (C1/C2): `explorer.openMode` was DELETED here and in app-settings.ts —
  // it was rendered, but nothing ever read it. Its job belongs to `editor.openOnClick`
  // below, which keeps its key (no rename, so no migration of a setting that works) and
  // is grouped HERE, where users look for it. A descriptor's section comes from `group`,
  // not from its key prefix (metadata.ts:65), which is what makes that possible.
  {
    key: 'editor.openOnClick',
    label: 'Open files with',
    description: 'Which file-tree click opens a file into the last active editor.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: ['single', 'double', 'none'],
  },
  {
    // US7 (#141) — where an opened file lands.
    key: 'editor.openTarget',
    label: 'Open files in',
    description: 'Where an opened file lands: the last active editor (reused), or a new editor panel.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: ['lastActive', 'new'],
  },
  {
    key: 'explorer.deleteMode',
    label: 'Delete files to',
    description: 'Send deleted files to the OS Recycle Bin, or delete permanently.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: ['recycle', 'permanent'],
  },
  {
    key: 'explorer.excludeGlobs',
    label: 'Excluded globs',
    description: 'Root-relative glob patterns hiding entries from the file tree.',
    group: 'File Explorer',
    control: 'array',
    itemControl: 'text',
    clearable: true, // empty = exclude nothing; the parser honours an explicit empty list
  },
  {
    key: 'explorer.dragCopyModifier',
    label: 'Copy-drag modifier',
    description: 'The modifier key that makes a file-tree drag copy instead of move.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: DRAG_MODIFIERS,
  },
  {
    key: 'explorer.dragMoveModifier',
    label: 'Move-drag modifier',
    description: 'The modifier key that forces a file-tree drag to move.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: DRAG_MODIFIERS,
  },

  // Terminals
  //
  // The three terminal-flavour controls (`terminals.flavours`, `terminals.disabledBuiltins`,
  // `terminals.defaultParams`) are WITHHELD from the Settings UI for v1.0.0 pending #67's proper
  // implementation in vNext — see SETTINGS_INTERNAL_KEYS above. Their descriptors are kept intact
  // in HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS below (this is a hide, not a revert); the rendered
  // registry must not carry them, or the completeness rule flags them as descriptors for keys that
  // are no longer configurable. Re-expose in vNext by spreading that array in here and dropping the
  // three keys from SETTINGS_INTERNAL_KEYS.

  // Editor
  //
  // `editor.openOnClick` keeps its key but is grouped under File Explorer, above (C2).
  {
    key: 'editor.autoSave',
    label: 'Auto-save',
    description: 'Write edits automatically after typing settles, without Ctrl+S.',
    group: 'Editor',
    control: 'toggle',
  },
  {
    // US8 (#154).
    key: 'editor.saveDocumentScroll',
    label: 'Save Document Scroll Position',
    description:
      'Remember each document’s scroll position: reopening a file in the same editor restores where you were, instead of starting at the top.',
    group: 'Editor',
    control: 'toggle',
  },
  {
    key: 'editor.autoSaveDebounceMs',
    label: 'Auto-save delay',
    description: 'Debounce (ms) after typing stops before an auto-save writes.',
    group: 'Editor',
    control: 'slider',
    min: 0,
    max: 10000,
    // 018: WIDENED from 50. A step must be at least 1% of the range (FR-035), and 50 across
    // 0–10000 is 0.5% — a slider with two hundred indistinguishable positions, which is no more
    // usable than no slider at all. Every other numeric already satisfied the rule; this was the
    // one that did not, and a rule the codebase does not satisfy is a red bar nobody can fix.
    step: 100,
  },
  {
    key: 'editor.saveAllScope',
    label: 'Save-All scope',
    description: 'The scope a Ctrl+Shift+S Save-All covers.',
    group: 'Editor',
    control: 'select',
    allowedValues: ['tab', 'project', 'all'],
  },
  {
    key: 'editor.defaultLineEnding',
    label: 'New-file line ending',
    description: 'The line ending applied to brand-new documents.',
    group: 'Editor',
    control: 'select',
    allowedValues: ['lf', 'crlf', 'cr'],
  },
  {
    key: 'editor.maxOpenFileBytes',
    // A SLIDER, in 5 MiB steps.
    //
    // 018 originally left this typed, and the reasoning was sound as far as it went: a slider running
    // from one kilobyte to gigabytes moves in megabyte jumps per pixel, which is a worse control than
    // the text box it replaces, and any ceiling would have been invented to serve the control rather
    // than because the system has one.
    //
    // What that reasoning missed is that the STEP is what makes a slider usable, not the range. Five
    // megabytes is the unit anybody actually thinks in here — nobody wants 10,486,784 bytes — and with
    // it the range collapses to fifty positions you can aim at. The ceiling is honest about what it is:
    // a practical limit for a PLAIN-TEXT editor, not a limit the system imposes. The field is still
    // there beside it, still typed, still digit-grouped, for anyone who wants an exact number.
    label: 'Max open file size',
    description:
      'Files larger than this report "too large" instead of opening. Measured in bytes; the slider moves in 5 MB steps.',
    group: 'Editor',
    control: 'slider',
    min: 5242880,
    max: 262144000,
    step: 5242880,
  },
  {
    key: 'editor.projectPathDisplay',
    label: 'Project editor path display',
    description: 'Show a project-owned editor pill as the full path or just the file name.',
    group: 'Editor',
    control: 'select',
    allowedValues: ['full', 'name'],
  },
  {
    key: 'editor.subWorkspacePathDisplay',
    label: 'Sub-workspace editor path display',
    description: 'Show a sub-workspace-owned editor pill as the full path or just the file name.',
    group: 'Editor',
    control: 'select',
    allowedValues: ['full', 'name'],
  },
  {
    key: 'editor.warnOnMissingFile',
    label: 'Warn on missing file',
    description: 'Show a popup when an editor’s file is missing or deleted.',
    group: 'Editor',
    control: 'toggle',
  },
  {
    key: 'editor.defaultWordWrap',
    label: 'Editor default word wrap',
    description: 'Wrap long lines by default in new editors. Toggle per editor from its status bar, its content menu, or Ctrl+Alt+W.',
    group: 'Editor',
    control: 'toggle',
  },
  {
    key: 'editor.showStatusBar',
    label: 'Show editor status bar',
    description: 'Show the status strip along the bottom of each editor panel (language, word-wrap toggle).',
    group: 'Editor',
    control: 'toggle',
  },
  {
    key: 'terminals.showStatusBar',
    label: 'Show terminal status bar',
    description: 'Show the status bar along the bottom of each terminal panel.',
    group: 'Terminal',
    control: 'toggle',
  },

  // Indentation (016, FR-018/FR-022). The order of precedence is the requirement: what the FILE
  // already does beats the language, which beats the global default. A setting NEVER reformats an
  // existing document (FR-018d) — it decides what the next keystroke inserts.
  {
    key: 'editor.indent.style',
    label: 'Indent with',
    description:
      'What a new indent inserts, unless the file already indents differently or its language says otherwise.',
    group: 'Editor · Indentation',
    control: 'select',
    allowedValues: ['spaces', 'tabs'],
  },
  // Bounded numerics, so they take the control those bounds exist for (018 / FR-032, SC-007). They
  // shipped as bare text boxes carrying a 1–16 range that nothing showed the user and nothing enforced
  // at the control — you could type 400 into a box that claimed to stop at 16.
  {
    key: 'editor.indent.indentWidth',
    label: 'Indent width',
    description: 'How many spaces one indent level inserts.',
    group: 'Editor · Indentation',
    control: 'slider',
    min: 1,
    max: 16,
    step: 1,
  },
  {
    key: 'editor.indent.tabWidth',
    label: 'Tab width',
    description:
      'How many columns a literal tab occupies on screen. Display only — it never changes the file’s contents.',
    group: 'Editor · Indentation',
    control: 'slider',
    min: 1,
    max: 16,
    step: 1,
  },
  {
    key: 'editor.indentByLanguage',
    label: 'Indentation by language',
    description:
      'Per-language indentation. A file that already indents differently still wins — this decides what a new indent inserts.',
    group: 'Editor · Indentation',
    control: 'map',
    keyLabel: 'Language',
    keyKind: 'language',
    columns: [
      { key: 'style', label: 'Indent with', control: 'select', allowedValues: ['spaces', 'tabs'] },
      { key: 'indentWidth', label: 'Width', control: 'number', min: 1, max: 16 },
      { key: 'tabWidth', label: 'Tab width', control: 'number', min: 1, max: 16 },
    ],
    // NOT clearable. Emptying it would not "turn off per-language indentation" — it would silently
    // indent Go with spaces and Python with two. There is no valid empty state here, and offering a
    // clear affordance would be offering to break the thing (FR-022c).
  },
  {
    key: 'editor.languageByExtension',
    label: 'Language by file extension',
    description:
      'Map a file extension to a language, e.g. “.foo” → Python. Overrides the built-in detection.',
    group: 'Editor · Languages',
    control: 'map',
    keyLabel: 'Extension',
    keyKind: 'text',
    columns: [{ label: 'Language', control: 'select' }],
    // Genuinely clearable: no mapping is a perfectly good state — it is the shipped one — and a
    // user who added a mapping must be able to take it away again (FR-022c).
    clearable: true,
  },
  {
    key: 'editor.persistUndoHistory',
    label: 'Keep undo history after a crash',
    description:
      'Restore the undo history along with unsaved changes when the app is reopened after a crash. Removed text lives in the recovery file until then.',
    group: 'Editor',
    control: 'toggle',
  },

  // New Project (011)
  {
    key: 'newProject.startingFolder',
    label: 'New project folder starts at',
    description:
      'Where the new-project folder picker opens: your user profile, the last folder you chose, or a fixed override.',
    group: 'New Project',
    control: 'select',
    allowedValues: ['profile', 'lastViewed', 'override'],
  },
  {
    key: 'newProject.overridePath',
    label: 'Override start folder',
    description:
      'The fixed folder the new-project picker opens at when "Override" is selected. Type a path or browse to pick one.',
    group: 'New Project',
    control: 'folder',
    clearable: true, // empty = no override; the picker falls back to last-viewed, then the profile
  },
  {
    key: 'search.asYouTypeDebounceMs',
    label: 'Find delay',
    description:
      'How long find waits after you stop typing before it re-runs the search and updates the highlights.',
    group: 'Search',
    control: 'slider',
    min: 0,
    max: 1000,
    step: 10,
  },
];

/**
 * The three terminal-flavour descriptors, WITHHELD from {@link SETTINGS_METADATA} for v1.0.0
 * pending #67's proper implementation in vNext (see {@link SETTINGS_INTERNAL_KEYS}).
 *
 * These are kept verbatim rather than deleted so vNext can re-expose the controls by simply
 * spreading this array back into the rendered registry and dropping the three keys from
 * SETTINGS_INTERNAL_KEYS — a hide, not a revert. They are NOT part of the rendered registry, so
 * the completeness rule (FR-047) neither demands nor rejects them; that is the whole point of
 * marking the keys internal. The underlying record/multiselect/map controls they drive (and the
 * tolerant parser that reads the settings from a hand-edited settings.json) remain live.
 */
export const HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS: MetadataRegistry = [
  {
    key: 'terminals.flavours',
    label: 'Custom terminal flavours',
    description:
      'User-defined shells shown in the Flavour dropdown (id, label, file, args, default params).',
    group: 'Terminals',
    // A structured RECORD table — one row per flavour, one cell per field (019, FR-018/#67).
    //
    // It was `control: 'array'` over items that are OBJECTS, so it fell to the JSON-textarea
    // fallback: hand-editing raw JSON inside the visual editor, with no per-field validation. And
    // the control FLIPPED WITH THE VALUE — an empty list rendered as a string-array editor whose
    // Add appended `''`, which the tolerant parser then dropped. The mode is declared now.
    control: 'records',
    idKey: 'id',
    itemNoun: 'flavour',
    columns: [
      { key: 'label', label: 'Label', control: 'text' },
      { key: 'file', label: 'Executable', control: 'text' },
      { key: 'args', label: 'Arguments', control: 'text' }, // string[] ↔ space-separated
      { key: 'defaultParams', label: 'Default params', control: 'text' },
    ],
    clearable: true, // no custom flavours is a perfectly good answer — and it is what it ships as
  },
  {
    key: 'terminals.disabledBuiltins',
    label: 'Hidden built-in flavours',
    description: 'Built-in flavour ids to hide from the Flavour dropdown.',
    group: 'Terminals',
    // A MULTI-SELECT over the built-ins this machine actually detected (019, FR-016/FR-017).
    //
    // It was `array` + `itemControl: 'text'`, which asked the user to free-type an id from a set
    // the app detected at startup and already knows: typo it and the setting silently does nothing,
    // because nothing is there to say the id is not real (007 FR-029). The options are DYNAMIC —
    // see contracts/terminal-flavours-ipc.md; the catalogue is the DETECTED set, never the visible
    // one, or hiding a built-in would be a one-way door.
    control: 'multiselect',
    clearable: true, // empty = hide nothing, which is also what it ships as
  },
  {
    // The descriptor this setting has ALWAYS lacked (016, F5). It ships as an empty map, so it
    // yielded zero leaves and slipped past the completeness rule — a JSON-only setting of exactly
    // the kind the constitution forbids. The `map` control closes it rather than stepping around it.
    key: 'terminals.defaultParams',
    label: 'Default flavour parameters',
    description:
      'Extra arguments passed to a flavour every time it starts, keyed by flavour id (e.g. pwsh → -NoLogo).',
    group: 'Terminals',
    control: 'map',
    columns: [{ label: 'Arguments', control: 'text' }],
    clearable: true, // ships empty; empty means "pass nothing extra", a perfectly good answer
  },
];
