/**
 * Key Bindings editor metadata (feature 007, FR-025a/030). One
 * {@link FieldDescriptor} per `ActionId`, grouped into labelled sections, driving
 * the grouped bindings list. Each descriptor's `control` is `'chord'` — the value
 * is edited via the capture modal, not a generic form control. The completeness
 * test asserts every action has a descriptor (FR-047). Pure; zero OS/DOM.
 */
import type { ActionId } from './keybindings.js';
import type { FieldDescriptor, MetadataRegistry } from './metadata.js';

function chord(key: ActionId, group: string, label: string, description: string): FieldDescriptor {
  return { key, label, description, group, control: 'chord' };
}

export const KEYBINDINGS_METADATA: MetadataRegistry = [
  // Zoom
  chord('zoom.in', 'Zoom', 'Zoom in', 'Increase the interface zoom level.'),
  chord('zoom.out', 'Zoom', 'Zoom out', 'Decrease the interface zoom level.'),
  chord('zoom.reset', 'Zoom', 'Reset zoom', 'Return the interface zoom to 100%.'),

  // View
  chord('view.fullscreen', 'View', 'Toggle fullscreen', 'Enter or leave fullscreen mode.'),
  chord(
    'view.toggleProjects',
    'View',
    'Toggle Projects sidebar',
    'Show or hide the Projects & Sub-workspaces sidebar pane.',
  ),
  chord(
    'view.toggleExplorer',
    'View',
    'Toggle File Explorer',
    'Show or hide the Files & Folders pane.',
  ),

  // File Explorer (resolved while the File Explorer pane has focus)
  chord('file.rename', 'File Explorer', 'Rename', 'Rename the selected file or folder.'),
  chord('file.cut', 'File Explorer', 'Cut', 'Cut the selected file or folder.'),
  chord('file.copy', 'File Explorer', 'Copy', 'Copy the selected file or folder.'),
  chord('file.paste', 'File Explorer', 'Paste', 'Paste into the selected folder.'),
  chord('file.delete', 'File Explorer', 'Delete', 'Delete the selected file or folder.'),

  // Editor (resolved while the active pane is a workspace editor panel)
  chord('editor.save', 'Editor', 'Save', 'Save the active editor document.'),
  chord('editor.saveAll', 'Editor', 'Save all', 'Save all open editor documents in scope.'),
  chord('editor.saveAs', 'Editor', 'Save as', 'Save the active document to a new location.'),
];
