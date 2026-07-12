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

  // Focus & Zoom (012) — per-panel-type text zoom, routed to the active panel's
  // type; distinct from the app-wide zoom above.
  chord(
    'panel.zoomIn',
    'Focus & Zoom',
    'Zoom panel type in',
    "Increase the text size of every panel of the active panel's type.",
  ),
  chord(
    'panel.zoomOut',
    'Focus & Zoom',
    'Zoom panel type out',
    "Decrease the text size of every panel of the active panel's type.",
  ),
  chord(
    'panel.zoomReset',
    'Focus & Zoom',
    'Reset panel type zoom',
    "Return the active panel's type to its default text size.",
  ),
  chord(
    'focus.left',
    'Focus & Zoom',
    'Focus panel to the left',
    'Move the active panel focus to the adjacent panel on the left.',
  ),
  chord(
    'focus.right',
    'Focus & Zoom',
    'Focus panel to the right',
    'Move the active panel focus to the adjacent panel on the right.',
  ),
  chord(
    'focus.up',
    'Focus & Zoom',
    'Focus panel above',
    'Move the active panel focus to the adjacent panel above.',
  ),
  chord(
    'focus.down',
    'Focus & Zoom',
    'Focus panel below',
    'Move the active panel focus to the adjacent panel below.',
  ),
  chord(
    'focus.cycle',
    'Focus & Zoom',
    'Cycle focus forward',
    'Move focus to the next panel in layout order, wrapping at the end.',
  ),
  chord(
    'focus.cycleBack',
    'Focus & Zoom',
    'Cycle focus backward',
    'Move focus to the previous panel in layout order, wrapping at the start.',
  ),

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

  // Search (013) — one shared find bar routed to the active panel. A terminal
  // searches its scrollback (read-only); an editor searches and replaces its file.
  chord('search.find', 'Search', 'Find', 'Open find on the active panel.'),
  chord('search.findNext', 'Search', 'Find next', 'Move to the next match, wrapping at the end.'),
  chord(
    'search.findPrevious',
    'Search',
    'Find previous',
    'Move to the previous match, wrapping at the start.',
  ),
  chord('search.close', 'Search', 'Close find', 'Close the find bar and clear its highlights.'),
  chord('search.replace', 'Search', 'Replace', 'Open find with replace on the active editor.'),
  chord(
    'search.replaceCurrent',
    'Search',
    'Replace match',
    'Replace the current match and move to the next one.',
  ),
  chord(
    'search.replaceAll',
    'Search',
    'Replace all',
    'Replace every match in the file as a single undoable step.',
  ),

  // Terminal scrollback navigation (013) — view-only movement through retained
  // output; these keys are never delivered to the running program.
  chord(
    'terminal.scrollLineUp',
    'Terminal',
    'Scroll line up',
    'Scroll the terminal view up by one line.',
  ),
  chord(
    'terminal.scrollLineDown',
    'Terminal',
    'Scroll line down',
    'Scroll the terminal view down by one line.',
  ),
  chord(
    'terminal.scrollPageUp',
    'Terminal',
    'Scroll page up',
    'Scroll the terminal view up by one screen.',
  ),
  chord(
    'terminal.scrollPageDown',
    'Terminal',
    'Scroll page down',
    'Scroll the terminal view down by one screen.',
  ),
  chord(
    'terminal.scrollToTop',
    'Terminal',
    'Scroll to top',
    'Jump to the oldest retained line of scrollback.',
  ),
  chord(
    'terminal.scrollToBottom',
    'Terminal',
    'Scroll to bottom',
    'Jump to the newest output and resume following it.',
  ),
];
