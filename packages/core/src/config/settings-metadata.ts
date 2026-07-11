/**
 * Settings editor metadata (feature 007, FR-025a/026–029). One
 * {@link FieldDescriptor} per configurable leaf of {@link AppSettings}, grouped
 * into labelled sections, driving the generic Settings form. The completeness
 * test (`settings-metadata.test.ts`) asserts every leaf except the internal
 * `version` marker has exactly one descriptor (FR-047). Pure; zero OS/DOM.
 */
import { DEFAULT_APP_SETTINGS } from './app-settings.js';
import { leavesOf, type FieldDescriptor, type MetadataRegistry } from './metadata.js';

/** Leaves that are internal bookkeeping, not user-configurable settings. */
export const SETTINGS_INTERNAL_KEYS: readonly string[] = [
  'version',
  // The folder last chosen for a project — machine bookkeeping that drives the
  // "Last Viewed" picker option (011), not a hand-tuned setting.
  'newProject.lastProjectFolder',
];

/** The configurable settings leaves (every leaf minus the internal keys). */
export function settingsLeaves(): string[] {
  return leavesOf(DEFAULT_APP_SETTINGS).filter((k) => !SETTINGS_INTERNAL_KEYS.includes(k));
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
    control: 'number',
    min: 200,
    max: 1200,
    step: 10,
  },
  {
    key: 'panes.fileExplorer.maxWidth',
    label: 'File Explorer pane max width',
    description: 'The widest (px) the Files & Folders pane can be dragged.',
    group: 'Panes',
    control: 'number',
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
    control: 'number',
    min: 0,
    max: 5000,
    step: 50,
  },
  {
    key: 'behaviour.submenuHoverMs',
    label: 'Submenu hover delay',
    description: 'Dwell time (ms) before a context-menu submenu opens.',
    group: 'Behaviour',
    control: 'number',
    min: 0,
    max: 2000,
    step: 25,
  },

  // File Explorer
  {
    key: 'explorer.openMode',
    label: 'Open files with',
    description: 'Whether a single or double click opens a file from the tree.',
    group: 'File Explorer',
    control: 'select',
    allowedValues: ['single', 'double'],
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
  {
    key: 'terminals.flavours',
    label: 'Custom terminal flavours',
    description:
      'User-defined shells shown in the Flavour dropdown (id, label, file, args, default params).',
    group: 'Terminals',
    control: 'array', // items are objects — the array editor renders a per-entry sub-form
  },
  {
    key: 'terminals.disabledBuiltins',
    label: 'Hidden built-in flavours',
    description: 'Built-in flavour ids to hide from the Flavour dropdown.',
    group: 'Terminals',
    control: 'array',
    itemControl: 'text',
  },

  // Editor
  {
    key: 'editor.openOnClick',
    label: 'Open file into editor on',
    description: 'Which file-tree click opens a file into the last active editor.',
    group: 'Editor',
    control: 'select',
    allowedValues: ['single', 'double', 'none'],
  },
  {
    key: 'editor.autoSave',
    label: 'Auto-save',
    description: 'Write edits automatically after typing settles, without Ctrl+S.',
    group: 'Editor',
    control: 'toggle',
  },
  {
    key: 'editor.autoSaveDebounceMs',
    label: 'Auto-save delay',
    description: 'Debounce (ms) after typing stops before an auto-save writes.',
    group: 'Editor',
    control: 'number',
    min: 0,
    max: 10000,
    step: 50,
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
    label: 'Max open file size',
    description: 'Files larger than this (bytes) report "too large" instead of opening.',
    group: 'Editor',
    control: 'number',
    min: 1024,
    step: 1024,
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
  },
];
