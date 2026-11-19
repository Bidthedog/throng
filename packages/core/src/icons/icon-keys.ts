/**
 * The icon keys (spec 069 FR-010 to FR-012). One key per icon throng draws. The key is also the file
 * name a user icon set overrides it with (`<key>.svg`), and the default set has art for every one
 * (FR-004). The descriptions show in Preferences → Themes → Icons and in the icon sets README.
 */

export const ICON_KEYS = [
  'destroy',
  'deleteFile',
  'dismiss',
  'cancel',
  'collapse',
  'expand',
  'rename',
  'send',
  'tab',
  'add',
  'save',
  'saveAs',
  'dismissAll',
  'sortOrder',
  'minimisePanel',
  'restorePanel',
  'noticeError',
  'noticeAttention',
  'noticeInfo',
  'noticeSuccess',
  'detach',
  'retry',
  'restoreAll',
  'revert',
  'editJson',
  'editVisual',
  'moveUp',
  'moveDown',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'folder',
  'folderOpen',
  'chevron',
  'file',
  'fileCode',
  'fileJson',
  'fileMarkdown',
  'fileImage',
  'fileText',
  'symlink',
  'fileArchive',
  'fileShell',
  'fileConfig',
  'fileSpreadsheet',
  'fileDatabase',
  'fileDiff',
  'fileKey',
  'fileAudio',
  'fileVideo',
  'fileFont',
  'fileModel',
  'filePackage',
  'folderSymlink',
  'folderGit',
  'folderConfig',
  'folderDependencies',
  'fileC',
  'fileCpp',
  'fileCsharp',
  'fileJava',
  'fileJavaScript',
  'fileTypeScript',
  'filePython',
  'fileGo',
  'fileRust',
  'fileRuby',
  'fileR',
  'fileLua',
  'fileDart',
  'fileSwift',
  'fileScala',
  'fileKotlin',
  'filePhp',
  'fileSql',
  'fileHtml',
  'fileCss',
  'fileSass',
  'filePowerShell',
  'editorPanel',
  'expandAll',
  'collapseAll',
  'newFolder',
  'quickOpen',
  'terminal',
  'search',
  'findNext',
  'findPrevious',
  'findInFiles',
  'searchScope',
  'matchCase',
  'wholeWord',
  'replace',
  'replaceAll',
  'settings',
  'windowMinimise',
  'windowMaximise',
  'windowRestore',
  'windowClose',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'undo',
  'redo',
  'language',
  'keybindings',
  'themes',
  'about',
  'hide',
  'showHidden',
  'resourceMonitor',
  'resourceCpu',
  'resourceMemory',
  'resourceGpu',
  'resourceIo',
  'resourceHideIdle',
  'resourceKill',
  'resourceKillBelow',
  'chevronLeft',
  'chevronRight',
  'chevronDown',
  'preview',
  'refresh',
  'navigateBack',
  'navigateForward',
  'syncScroll',
  'unload',
  'category',
  'foldSectionExpanded',
  'foldSectionCollapsed',
  'foldPreviewExpanded',
  'foldPreviewCollapsed',
  'panelMaximise',
  'panelRestore',
  'diagramFit',
  'diagramZoomReset',
  'diagramFullPane',
  'warning',
  'whitespace',
  'busy',
  'groupFolderTree',
  'projectSettings',
  'searchExclusions',
  'help',
  'activate',
  'resourceHideEnded',
  'resourceNetwork',
  'dragHandle',
  'menuChecked',
  'overrideIcon',
  'rememberCommand',
  'rememberDirectory',
  'terminalNotifications',
  'cellDialog',
  'insertRowAbove',
  'insertRowBelow',
  'insertColumnLeft',
  'insertColumnRight',
  'resetColumnWidth',
  'resetRowHeight',
  'goToRow',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

/** What each icon stands for, in one short description (FR-012). */
export const ICON_KEY_DESCRIPTIONS: Readonly<Record<IconKey, string>> = {
  destroy:
    'The icon on the control that permanently closes and discards a terminal, panel, or project, and on the Icons row control that deletes your icon set.',
  deleteFile:
    'The icon on the File Explorer’s Delete, in its toolbar and its menu, which deletes the selected files and folders — to the OS trash, or for good, as Preferences say.',
  dismiss:
    'The icon on the control that clears a transient message such as an error bar or notice, without destroying anything.',
  cancel:
    'The icon on the control that stops a running operation, such as cancelling a paste in progress.',
  collapse:
    'The icon on the control that folds a pane or section closed.',
  expand:
    'The icon on the control that opens a collapsed pane or section.',
  rename:
    'The icon on the control that starts editing the name of a project, tab, panel, or your icon set.',
  send:
    'The icon on the control that submits the typed input to its target.',
  tab:
    'The icon that marks a workspace tab.',
  add:
    'The icon on the control that creates a new tab, terminal, or entry.',
  save:
    'The icon on the editor title bar button that saves the document.',
  saveAs:
    'The icon on the editor title bar button that saves the document under a new name.',
  dismissAll:
    'The icon on the Notifications panel control that dismisses every notification at once.',
  sortOrder:
    'The icon on the Notifications panel control that chooses the order notifications are listed in.',
  minimisePanel:
    'The icon on every control that hides a side pane or minimises a side panel: the side panes\' hide buttons, and the Minimise button and menu item of the Notifications and Sub-workspaces panels. Draw it pointing down; throng turns it to face the edge the pane or panel collapses toward.',
  restorePanel:
    'The icon on every control that shows a hidden side pane or restores a minimised side panel: the side panes\' show buttons, and the Restore button and menu item of the Notifications and Sub-workspaces panels. Draw it pointing up; throng turns it to face the way the pane or panel opens.',
  noticeError:
    'The icon at the top left of an error entry in the Notifications panel, before its title.',
  noticeAttention:
    'The icon at the top left of an attention entry in the Notifications panel, before its title.',
  noticeInfo:
    'The icon at the top left of an information entry in the Notifications panel, before its title.',
  noticeSuccess:
    'The icon at the top left of a success entry in the Notifications panel, before its title. A warning entry draws the Warning icon.',
  detach:
    'The icon on the control that tears a tab or panel out into its own window.',
  retry:
    'The icon on the control that re-runs a failed or interrupted action, such as reconnecting a dropped terminal session.',
  restoreAll:
    'The icon on the control that returns every built-in theme to the values it was shipped with, leaving your own themes untouched.',
  revert:
    'The icon on the control that undoes your changes to a single preference, putting it back to the value it had when you opened this window — which is not necessarily the value Throng ships with.',
  editJson:
    'The icon on the preferences toggle that swaps the visual editor for the raw configuration text, so you can type the underlying values by hand.',
  editVisual:
    'The icon on the preferences toggle that swaps the raw configuration text back for the visual editor, with its labelled rows and controls.',
  moveUp:
    'The icon on the control that moves an entry one place earlier in a list you are editing, such as a folder-exclusion rule.',
  moveDown:
    'The icon on the control that moves an entry one place later in a list you are editing, such as a folder-exclusion rule.',
  zoomIn:
    'The icon on the panel menu control that enlarges that panel’s text.',
  zoomOut:
    'The icon on the panel menu control that shrinks that panel’s text.',
  zoomReset:
    'The icon on the panel menu control that returns that panel’s text to its default size.',
  folder:
    'The icon shown beside a closed folder in the File Explorer tree.',
  folderOpen:
    'The icon shown beside an expanded folder in the File Explorer tree.',
  chevron:
    'The small arrow that twists to reveal or hide a folder\'s children in the tree.',
  file:
    'The icon shown beside an ordinary file in the tree.',
  fileCode:
    'The icon shown beside a source-code file in the tree.',
  fileJson:
    'The icon shown beside a structured-data file in the tree.',
  fileMarkdown:
    'The icon shown beside a Markdown document in the tree.',
  fileImage:
    'The icon shown beside an image file in the tree.',
  fileText:
    'The icon shown beside a plain-text file in the tree.',
  symlink:
    'The badge marking a tree entry that points to another location.',
  fileArchive:
    'The icon shown beside a compressed archive in the tree, such as a zip or tar file.',
  fileShell:
    'The icon shown beside a shell or batch script in the tree.',
  fileConfig:
    'The icon shown beside a configuration file in the tree, such as YAML, TOML, an INI file or a dotfile.',
  fileSpreadsheet:
    'The icon shown beside a spreadsheet or table of values in the tree, such as a CSV file.',
  fileDatabase:
    'The icon shown beside a database or SQL file in the tree.',
  fileDiff:
    'The icon shown beside a diff or patch file in the tree.',
  fileKey:
    'The icon shown beside a key or certificate file in the tree.',
  fileAudio:
    'The icon shown beside a sound file in the tree.',
  fileVideo:
    'The icon shown beside a video file in the tree.',
  fileFont:
    'The icon shown beside a font file in the tree.',
  fileModel:
    'The icon shown beside a three-dimensional model file in the tree.',
  filePackage:
    'The icon shown beside an installer or software package in the tree.',
  folderSymlink:
    'The badge marking a folder in the tree that points to another location.',
  folderGit:
    'The icon shown beside a Git repository folder in the tree.',
  folderConfig:
    'The icon shown beside a folder of editor or tool settings in the tree, such as .vscode or .github.',
  folderDependencies:
    'The icon shown beside a folder of installed dependencies in the tree, such as node_modules.',
  fileC:
    'The icon shown beside a C source file in the tree.',
  fileCpp:
    'The icon shown beside a C++ source file in the tree.',
  fileCsharp:
    'The icon shown beside a C# source file in the tree.',
  fileJava:
    'The icon shown beside a Java source file in the tree.',
  fileJavaScript:
    'The icon shown beside a JavaScript source file in the tree.',
  fileTypeScript:
    'The icon shown beside a TypeScript source file in the tree.',
  filePython:
    'The icon shown beside a Python source file in the tree.',
  fileGo:
    'The icon shown beside a Go source file in the tree.',
  fileRust:
    'The icon shown beside a Rust source file in the tree.',
  fileRuby:
    'The icon shown beside a Ruby source file in the tree.',
  fileR:
    'The icon shown beside a R source file in the tree.',
  fileLua:
    'The icon shown beside a Lua source file in the tree.',
  fileDart:
    'The icon shown beside a Dart source file in the tree.',
  fileSwift:
    'The icon shown beside a Swift source file in the tree.',
  fileScala:
    'The icon shown beside a Scala source file in the tree.',
  fileKotlin:
    'The icon shown beside a Kotlin source file in the tree.',
  filePhp:
    'The icon shown beside a PHP source file in the tree.',
  fileSql:
    'The icon shown beside a SQL source file in the tree.',
  fileHtml:
    'The icon shown beside a HTML source file in the tree.',
  fileCss:
    'The icon shown beside a CSS source file in the tree.',
  fileSass:
    'The icon shown beside a Sass source file in the tree.',
  filePowerShell:
    'The icon shown beside a PowerShell source file in the tree.',
  editorPanel:
    'The icon at the head of an editor panel’s title marking it as a text editor.',
  expandAll:
    'The icon on the toolbar control that opens every folder in the tree, and on the Preferences control that unfolds every section.',
  collapseAll:
    'The icon on the toolbar control that folds every folder in the tree closed, and on the Preferences control that folds every section.',
  newFolder:
    'The icon on the toolbar control that creates a folder in the tree.',
  quickOpen:
    'The icon on the toolbar control that opens any file in the project by typing part of its path.',
  terminal:
    'The icon that marks a terminal panel or a new-terminal control.',
  search:
    'The icon on the control that opens the find bar over the active panel.',
  findNext:
    'The icon on the control that steps forward to the following match.',
  findPrevious:
    'The icon on the control that steps back to the preceding match.',
  findInFiles:
    'The icon on the toolbar control and folder menu item that searches every file in the project for a piece of text.',
  searchScope:
    'The icon on the control that shows which folders and files a Find in Files search is looking through, and lets you change them.',
  matchCase:
    'The icon on the toggle that makes the search distinguish capital letters from small ones.',
  wholeWord:
    'The icon on the toggle that restricts the search to complete words rather than fragments.',
  replace:
    'The icon on the control that swaps the current match for the replacement text.',
  replaceAll:
    'The icon on the control that swaps every match for the replacement text at once.',
  settings:
    'The gear that opens preferences from the title bar, and a project’s own options from its pane.',
  windowMinimise:
    'The icon on the control that drops a window out of sight without closing it.',
  windowMaximise:
    'The icon on the control that grows a window to fill the whole display.',
  windowRestore:
    'The icon on the control that brings a filled window back to the size it was before.',
  windowClose:
    'The icon on the control that shuts a window for good.',
  cut:
    'The icon on the menu row that lifts the selected text or files onto the clipboard and removes them from where they were.',
  copy:
    'The icon on the menu row that places the selected text or files onto the clipboard, leaving the originals in place.',
  paste:
    'The icon on the menu row that drops whatever the clipboard holds in at the cursor or the chosen folder.',
  selectAll:
    'The icon on the menu row that highlights the whole document at once, ready to act on together.',
  undo:
    'The icon on the editor menu row that steps the last change back out of the document.',
  redo:
    'The icon on the editor menu row that reapplies a change you had just stepped back out.',
  language:
    'The icon on the editor menu row that opens the picker for which language colours and folds the file.',
  keybindings:
    'The icon on the title-bar menu row that opens the editor for the keyboard shortcuts you can rebind.',
  themes:
    'The icon on the title-bar menu row that opens the editor for the colours, fonts, and icons the app wears.',
  about:
    'The icon on the title-bar menu row that opens the window naming the release and its build details.',
  hide:
    'The icon on the tree menu row that drops a file or folder out of view for this project only.',
  showHidden:
    'The icon on the Quick Open control that brings the files this project hides back into the list, for that one search.',
  resourceMonitor:
    'The icon on the status-bar item that shows throng\'s CPU, memory, GPU and I/O, and on the title-bar menu row that opens the Resource Monitor.',
  resourceCpu:
    'The icon beside the CPU figure in the status bar, and on the Resource Monitor\'s "show by CPU" choice.',
  resourceMemory:
    'The icon beside the memory figure in the status bar, and on the Resource Monitor\'s "show by memory" choice.',
  resourceGpu:
    'The icon beside the GPU figure in the status bar, and on the Resource Monitor\'s "show by GPU" choice.',
  resourceIo:
    'The icon beside the I/O figure in the status bar, and on the Resource Monitor\'s "show by I/O" choice.',
  resourceHideIdle:
    'The icon on the Resource Monitor control that hides processes doing nothing.',
  resourceKill:
    'The icon on the Resource Monitor row that ends one process.',
  resourceKillBelow:
    'The icon on the Resource Monitor row that ends every process beneath a project, tab, panel or process.',
  chevronLeft:
    'The icon on the control at the left end of the tab strip that brings the tabs hidden off that edge back into view.',
  chevronRight:
    'The icon on the control at the right end of the tab strip that brings the tabs hidden off that edge back into view.',
  chevronDown:
    'The icon on the tab strip control that drops open a searchable list of every tab in the window, however many are on screen.',
  preview:
    'The icon on the editor status bar button and menu rows that open a rendered, read-only view of a file such as a Markdown document, and at the head of that preview panel’s title.',
  refresh:
    'The icon on the preview panel menu row that reads the file or its open document again and redraws the preview straight away.',
  navigateBack:
    'The icon on the button at the top left of an editor or preview panel, and its menu row, that returns the panel to the file it showed before.',
  navigateForward:
    'The icon on the button at the top left of an editor or preview panel, and its menu row, that moves the panel on again to a file you stepped back from.',
  syncScroll:
    'The icon on the Synchronise Scrolling button on the editor\'s and the preview\'s status bars, and on the Synchronise Scrolling menu rows, that turns scrolling an editor and its preview together on or off.',
  unload:
    'The icon on a project\'s two Unload context-menu rows, which detach it from the window without deleting anything on disk.',
  category:
    'The icon on a project\'s Move to Category context-menu row, which reassigns it to a different category.',
  foldSectionExpanded:
    'The marker on an expanded heading\'s line in a Markdown editor\'s fold gutter. Clicking it collapses the section.',
  foldSectionCollapsed:
    'The marker on a collapsed heading\'s line in a Markdown editor\'s fold gutter. Clicking it expands the section.',
  foldPreviewExpanded:
    'The disclosure triangle beside an expanded heading in a Markdown preview’s fold gutter. Clicking it collapses the section.',
  foldPreviewCollapsed:
    'The disclosure triangle beside a collapsed heading in a Markdown preview’s fold gutter. Clicking it expands the section.',
  panelMaximise:
    'The icon on a panel header\'s Maximise button and its menu row, which puts the panel in Focus Mode: it fills its tab\'s middle section until it is restored.',
  panelRestore:
    'The icon on the Exit Focus Mode control of a panel or a diagram in Focus Mode, which puts it back where it was.',
  diagramFit:
    'The icon on a diagram\'s Fit control, which shrinks the diagram to fit the width of its box.',
  diagramZoomReset:
    'The icon on a diagram\'s Zoom 100% control, which shows the diagram at its actual size, between the zoom-out and zoom-in controls.',
  diagramFullPane:
    'The icon on a diagram\'s Enter Focus Mode control, which fills the whole middle section with the diagram and hides the side panes until you leave Focus Mode.',
  warning:
    'The marker on a folded Preferences section or subsection that hides a setting holding an invalid entry.',
  whitespace:
    'The icon on the editor status bar toggle that shows or hides a symbol for every space, tab, line break and invisible character.',
  busy:
    'The icon on the Find in Files cancel control while a search is running. It turns while the search runs; clicking it cancels.',
  groupFolderTree:
    'The icon on the Find in Files control that arranges results in the File Explorer’s folder tree.',
  projectSettings:
    'The icon on the File Explorer control that opens the active project’s settings — what it hides from the tree and from Find in Files.',
  searchExclusions:
    'The icon on the Find in Files toggle that switches the search exclusion list on or off for that panel.',
  help:
    'The icon on the Resource Monitor control that explains what it shows and how to use it.',
  activate:
    'The icon on the Resource Monitor control that goes to the project, tab or panel a row names, bringing its window forward.',
  resourceHideEnded:
    'The icon on the Resource Monitor control that hides processes that have ended.',
  resourceNetwork:
    'The icon on the Resource Monitor\'s "order by Network" choice.',
  dragHandle:
    'The icon on the handle you drag to move a project or sub-workspace to a new place in its list.',
  menuChecked:
    'The icon on a menu row whose option is switched on.',
  overrideIcon:
    'The icon on the Icons row control that copies the default icon into your icon set, ready for you to replace with your own file.',
  rememberCommand:
    'The icon on the terminal status bar toggle that keeps a terminal’s startup command up to date with the command running when it ends, so it runs again next time. Draw it plain: throng greys it out and draws a line through it while the toggle is off.',
  rememberDirectory:
    'The icon on the terminal status bar toggle that reopens a terminal in the folder it was last working in, rather than where it first started. Draw it plain: throng greys it out and draws a line through it while the toggle is off.',
  terminalNotifications:
    'The icon on the terminal status bar toggle that lets that one terminal raise attention marks, pop-ups and desktop notifications, or silences it. Draw it plain: throng greys it out and draws a line through it while the toggle is off.',
  cellDialog:
    'The icon on the CSV Preview Editor status bar toggle that turns the cell dialog, the editor long cells open in, on or off for that panel.',
  insertRowAbove:
    'The icon on the grid menu row that inserts an empty row above the active row.',
  insertRowBelow:
    'The icon on the grid menu row that inserts an empty row below the active row.',
  insertColumnLeft:
    'The icon on the grid menu row that inserts an empty column to the left of the active column.',
  insertColumnRight:
    'The icon on the grid menu row that inserts an empty column to the right of the active column.',
  resetColumnWidth:
    'The icon on the grid menu row that puts a column back to the default width.',
  resetRowHeight:
    'The icon on the grid menu row that puts a row back to one line high.',
  goToRow:
    'The icon on the grid menu row that asks for a row number and goes to that row.',
};

/** Is `value` one of the icon keys? */
export function isIconKey(value: string): value is IconKey {
  return (ICON_KEYS as readonly string[]).includes(value);
}
