/**
 * The guide map (080 FR-004a): every task the user guide teaches, the page and section that teaches it,
 * and the commands, panel types, preview types and settings that task uses. It is the one source for
 * the app's help URLs (`help-urls.ts`), the PR coverage checks (`docs-currency.test.ts`) and the release
 * check (`config/release-notes.ts`).
 *
 * A task here is a `##` section of `site/guide/<page>.md`, headed by `task` word for word; `anchor` is that
 * heading's slug. Anything the app has that no user task covers is listed in `GUIDE_EXCLUSIONS` with the
 * reason (developer-only features). The page list follows `specs/080-help-and-wiki/page-plan.md`.
 */
import type { ActionId } from '../config/keybindings.js';

export type GuidePageSlug =
  | 'index'
  | 'quick-start'
  | 'projects'
  | 'layout'
  | 'sub-workspaces'
  | 'terminals'
  | 'attention'
  | 'files'
  | 'editing'
  | 'finding'
  | 'previews'
  | 'markdown'
  | 'csv-and-spreadsheets'
  | 'images-pdfs-svg-html'
  | 'preferences'
  | 'themes-and-icons'
  | 'key-bindings'
  | 'resources'
  | 'troubleshooting'
  | 'faq';

export interface GuidePage {
  readonly slug: GuidePageSlug;
  /** The page's title, equal to its front matter and to its page-plan heading. */
  readonly title: string;
}

export interface GuideTask {
  readonly page: GuidePageSlug;
  /** The task heading's slug within its page. */
  readonly anchor: string;
  /** The task heading, in the user's words, exactly as the page writes it. */
  readonly task: string;
  readonly commands: readonly ActionId[];
  /** Panel-type registry kinds. */
  readonly panelTypes: readonly string[];
  /** Ids of the shipped preview providers. */
  readonly previewTypes: readonly string[];
  /** Setting keys from the settings metadata. */
  readonly settings: readonly string[];
}

export interface GuideExclusion {
  readonly kind: 'command' | 'panelType' | 'previewType';
  readonly id: string;
  /** Why no user task covers it. */
  readonly reason: string;
}

/** Every guide page, in navigation order. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: 'index', title: 'Intro' },
  { slug: 'quick-start', title: 'Quick start' },
  { slug: 'projects', title: 'Projects' },
  { slug: 'layout', title: 'Tabs, panels and layout' },
  { slug: 'sub-workspaces', title: 'More windows: sub-workspaces' },
  { slug: 'terminals', title: 'Terminals' },
  { slug: 'attention', title: 'Knowing when something needs you' },
  { slug: 'files', title: 'Files' },
  { slug: 'editing', title: 'Editing' },
  { slug: 'finding', title: 'Finding things' },
  { slug: 'previews', title: 'Previews' },
  { slug: 'markdown', title: 'Markdown' },
  { slug: 'csv-and-spreadsheets', title: 'CSV files and spreadsheets' },
  { slug: 'images-pdfs-svg-html', title: 'Images, PDFs, SVG and HTML' },
  { slug: 'preferences', title: 'Preferences' },
  { slug: 'themes-and-icons', title: 'Themes and icons' },
  { slug: 'key-bindings', title: 'Key bindings' },
  { slug: 'resources', title: 'Watching resources' },
  { slug: 'troubleshooting', title: 'Troubleshooting' },
  { slug: 'faq', title: 'FAQ' },
];

type Covers = Partial<Pick<GuideTask, 'commands' | 'panelTypes' | 'previewTypes' | 'settings'>>;

/** One task, as its `##` heading in `site/guide/<page>.md` and its anchor; what it teaches defaults to nothing. */
function task(page: GuidePageSlug, anchor: string, title: string, covers: Covers = {}): GuideTask {
  return { page, anchor, task: title, commands: [], panelTypes: [], previewTypes: [], settings: [], ...covers };
}

/**
 * Every task the guide teaches, in page order (FR-004a). `docs-currency.test.ts` holds it equal to the guide's
 * headings both ways, and requires every command, panel type and preview type to appear here or in
 * `GUIDE_EXCLUSIONS`.
 */
export const GUIDE_MAP: readonly GuideTask[] = [
  task('index', 'get-help-from-inside-throng', 'Get help from inside throng', { commands: ['help.open'] }),
  task('quick-start', 'install-throng', 'Install throng'),
  task('quick-start', 'find-your-way-around-the-window', 'Find your way around the window', { commands: ['view.toggleProjects', 'view.toggleExplorer'] }),
  task('quick-start', 'add-your-first-project', 'Add your first project'),
  task('quick-start', 'open-a-terminal-in-your-project', 'Open a terminal in your project', { panelTypes: ['terminal'] }),
  task('quick-start', 'open-and-edit-a-file', 'Open and edit a file', { commands: ['editor.save'], panelTypes: ['editor'] }),
  task('quick-start', 'split-the-workspace-and-add-a-tab', 'Split the workspace and add a tab', { commands: ['panel.splitRight'] }),
  task('quick-start', 'where-to-go-next', 'Where to go next'),
  task('projects', 'add-a-project', 'Add a project'),
  task('projects', 'open-a-folder-as-a-project-from-your-file-manager', 'Open a folder as a project from your file manager'),
  task('projects', 'open-a-folder-as-a-project-from-the-command-line', 'Open a folder as a project from the command line', { commands: ['app.installCommandLine', 'app.uninstallCommandLine'] }),
  task('projects', 'switch-between-projects', 'Switch between projects', { commands: ['project.next', 'project.previous'] }),
  task('projects', 'rename-a-project-change-its-colour-or-move-its-folder', 'Rename a project, change its colour or move its folder'),
  task('projects', 'group-projects-into-categories', 'Group projects into categories'),
  task('projects', 'fold-rename-reorder-and-delete-categories', 'Fold, rename, reorder and delete categories'),
  task('projects', 'reorder-your-projects', 'Reorder your projects'),
  task('projects', 'unload-a-project-you-are-not-using', 'Unload a project you are not using'),
  task('projects', 'remove-a-project', 'Remove a project'),
  task('projects', 'open-a-projects-folder-or-copy-its-path', "Open a project's folder or copy its path"),
  task('projects', 'hide-files-in-one-project-or-keep-them-out-of-its-searches', 'Hide files in one project, or keep them out of its searches'),
  task('projects', 'read-a-projects-row-at-a-glance', "Read a project's row at a glance"),
  task('layout', 'understand-panes-tabs-and-panels', 'Understand panes, tabs and panels'),
  task('layout', 'choose-what-a-panel-shows', 'Choose what a panel shows'),
  task('layout', 'add-rename-reorder-and-close-tabs', 'Add, rename, reorder and close tabs', { commands: ['tabs.rename'] }),
  task('layout', 'find-a-tab-when-you-have-many', 'Find a tab when you have many', { commands: ['tabs.openPicker'] }),
  task('layout', 'split-a-panel', 'Split a panel', { commands: ['panel.splitDown', 'panel.splitUp', 'panel.splitLeft', 'panel.splitRight'] }),
  task('layout', 'resize-panels-and-side-panes', 'Resize panels and side panes'),
  task('layout', 'rearrange-panels-by-dragging', 'Rearrange panels by dragging'),
  task('layout', 'move-a-panel-to-another-tab', 'Move a panel to another tab'),
  task('layout', 'concentrate-on-one-panel', 'Concentrate on one panel', { commands: ['panel.toggleMaximise'] }),
  task('layout', 'zoom-text-in-panels-or-the-whole-window', 'Zoom text in panels or the whole window', { commands: ['panel.zoomIn', 'panel.zoomOut', 'panel.zoomReset', 'zoom.in', 'zoom.out', 'zoom.reset', 'view.fullscreen'] }),
  task('layout', 'show-and-hide-the-side-panes', 'Show and hide the side panes', { commands: ['view.toggleProjects', 'view.toggleExplorer'] }),
  task('layout', 'move-around-with-the-keyboard', 'Move around with the keyboard', { commands: ['focus.up', 'focus.down', 'focus.left', 'focus.right', 'focus.cycle', 'focus.cycleBack', 'focus.projects', 'focus.workspace', 'focus.explorer', 'menu.open'] }),
  task('layout', 'close-a-panel', 'Close a panel', { commands: ['panel.destroy'] }),
  task('layout', 'read-a-panels-header', "Read a panel's header"),
  task('layout', 'when-a-panel-fails', 'When a panel fails'),
  task('sub-workspaces', 'tear-a-tab-or-panel-off-into-its-own-window', 'Tear a tab or panel off into its own window'),
  task('sub-workspaces', 'show-a-tab-or-panel-in-another-window-as-well', 'Show a tab or panel in another window as well'),
  task('sub-workspaces', 'create-and-name-a-sub-workspace', 'Create and name a sub-workspace'),
  task('sub-workspaces', 'reopen-rename-recolour-reorder-or-destroy-a-sub-workspace', 'Reopen, rename, recolour, reorder or destroy a sub-workspace'),
  task('sub-workspaces', 'know-how-windows-behave', 'Know how windows behave'),
  task('terminals', 'open-a-terminal', 'Open a terminal', { panelTypes: ['terminal'] }),
  task('terminals', 'choose-your-shell', 'Choose your shell'),
  task('terminals', 'add-a-shell-of-your-own', 'Add a shell of your own'),
  task('terminals', 'run-a-command-when-the-terminal-starts', 'Run a command when the terminal starts'),
  task('terminals', 'reuse-what-you-typed-before', 'Reuse what you typed before'),
  task('terminals', 'change-how-a-terminal-is-set-up', 'Change how a terminal is set up'),
  task('terminals', 'reopen-in-the-folder-you-were-last-in', 'Reopen in the folder you were last in', { commands: ['terminal.toggleRememberDirectory'] }),
  task('terminals', 'pick-up-where-you-left-off-including-claude-code-sessions', 'Pick up where you left off, including Claude Code sessions', { commands: ['terminal.toggleRememberCommand'] }),
  task('terminals', 'give-terminals-useful-names', 'Give terminals useful names'),
  task('terminals', 'copy-paste-and-drop-paths', 'Copy, paste and drop paths'),
  task('terminals', 'search-what-scrolled-past', 'Search what scrolled past', { commands: ['search.find', 'search.findNext', 'search.findPrevious'] }),
  task('terminals', 'scroll-and-know-which-keys-reach-the-shell', 'Scroll, and know which keys reach the shell', { commands: ['terminal.scrollLineUp', 'terminal.scrollLineDown', 'terminal.scrollPageUp', 'terminal.scrollPageDown', 'terminal.scrollToTop', 'terminal.scrollToBottom'] }),
  task('terminals', 'follow-links-in-terminal-output', 'Follow links in terminal output'),
  task('terminals', 'clear-and-redraw', 'Clear and redraw', { commands: ['terminal.redraw'] }),
  task('terminals', 'keep-terminals-running-after-you-close-throng', 'Keep terminals running after you close throng'),
  task('terminals', 'start-terminals-only-when-you-ask', 'Start terminals only when you ask'),
  task('terminals', 'run-a-terminal-as-administrator-windows', 'Run a terminal as administrator (Windows)'),
  task('terminals', 'read-the-terminal-status-bar', 'Read the terminal status bar', { commands: ['terminal.toggleRememberCommand', 'terminal.toggleRememberDirectory', 'terminal.toggleNotifications'] }),
  task('terminals', 'when-a-terminal-will-not-start', 'When a terminal will not start'),
  task('attention', 'see-which-panels-need-you', 'See which panels need you'),
  task('attention', 'choose-what-raises-a-mark', 'Choose what raises a mark'),
  task('attention', 'get-notified-when-claude-code-needs-you', 'Get notified when Claude Code needs you'),
  task('attention', 'jump-to-the-next-panel-that-needs-you', 'Jump to the next panel that needs you', { commands: ['focus.nextMarkedPanel'] }),
  task('attention', 'flag-a-panel-as-a-reminder', 'Flag a panel as a reminder'),
  task('attention', 'silence-one-terminal', 'Silence one terminal', { commands: ['terminal.toggleNotifications'] }),
  task('attention', 'read-and-act-on-notifications', 'Read and act on notifications', { commands: ['focus.notice'] }),
  task('attention', 'keep-order-and-clear-the-notifications-panel', 'Keep, order and clear the Notifications panel'),
  task('attention', 'get-notified-outside-throng', 'Get notified outside throng'),
  task('attention', 'choose-what-each-kind-of-notice-does', 'Choose what each kind of notice does'),
  task('files', 'browse-your-projects-files', "Browse your project's files"),
  task('files', 'select-several-files', 'Select several files'),
  task('files', 'open-a-file', 'Open a file'),
  task('files', 'create-rename-and-delete-files-and-folders', 'Create, rename and delete files and folders', { commands: ['file.rename', 'file.delete'] }),
  task('files', 'move-or-copy-files-by-dragging', 'Move or copy files by dragging'),
  task('files', 'cut-copy-and-paste-including-between-projects', 'Cut, copy and paste, including between projects', { commands: ['file.cut', 'file.copy', 'file.paste'] }),
  task('files', 'choose-what-happens-when-a-name-already-exists', 'Choose what happens when a name already exists'),
  task('files', 'follow-and-cancel-a-large-paste', 'Follow and cancel a large paste'),
  task('files', 'undo-and-redo-file-changes', 'Undo and redo file changes', { commands: ['file.undo', 'file.redo'] }),
  task('files', 'work-with-your-systems-file-manager', "Work with your system's file manager"),
  task('files', 'look-at-a-files-properties-and-folder-sizes', "Look at a file's properties and folder sizes"),
  task('files', 'hide-files-from-the-tree', 'Hide files from the tree'),
  task('files', 'start-a-terminal-preview-or-search-from-a-folder', 'Start a terminal, preview or search from a folder'),
  task('files', 'when-a-file-will-not-move-rename-or-delete', 'When a file will not move, rename or delete'),
  task('files', 'recognise-files-at-a-glance', 'Recognise files at a glance'),
  task('editing', 'save-your-work', 'Save your work', { commands: ['editor.save', 'editor.saveAll', 'editor.saveAs'] }),
  task('editing', 'close-or-switch-files-with-unsaved-changes', 'Close or switch files with unsaved changes'),
  task('editing', 'set-the-language-of-a-file', 'Set the language of a file'),
  task('editing', 'indent-and-control-tabs-and-spaces', 'Indent, and control tabs and spaces', { commands: ['editor.indentLines', 'editor.outdentLines'] }),
  task('editing', 'edit-several-places-at-once', 'Edit several places at once', { commands: ['editor.columnSelectUp', 'editor.columnSelectDown', 'editor.columnSelectLeft', 'editor.columnSelectRight'] }),
  task('editing', 'cut-and-copy-whole-lines', 'Cut and copy whole lines', { commands: ['editor.cutLine'] }),
  task('editing', 'wrap-lines-and-show-invisible-characters', 'Wrap lines and show invisible characters', { commands: ['editor.toggleWordWrap', 'editor.toggleWhitespace'] }),
  task('editing', 'change-encoding-or-line-endings', 'Change encoding or line endings', { commands: ['editor.changeEncoding', 'editor.reopenWithEncoding', 'editor.convertLineEndingsToLf', 'editor.convertLineEndingsToCrlf', 'editor.convertLineEndingsToCr', 'editor.insertLineBreakLf', 'editor.insertLineBreakCrlf', 'editor.insertLineBreakCr'] }),
  task('editing', 'fold-markdown-sections', 'Fold Markdown sections', { commands: ['markdown.toggleSection', 'markdown.collapseSection', 'markdown.expandSection', 'markdown.toggleAll', 'markdown.collapseAll', 'markdown.expandAll', 'markdown.collapseAllInside', 'markdown.expandAllInside'] }),
  task('editing', 'jump-to-a-line', 'Jump to a line', { commands: ['navigate.gotoLine'] }),
  task('editing', 'follow-links-in-your-files', 'Follow links in your files'),
  task('editing', 'go-back-to-where-you-were', 'Go back to where you were', { commands: ['navigate.back', 'navigate.forward'] }),
  task('editing', 'read-the-editor-status-bar', 'Read the editor status bar'),
  task('editing', 'when-a-file-changes-on-disk-or-goes-missing', 'When a file changes on disk or goes missing'),
  task('editing', 'get-your-work-back-after-a-crash', 'Get your work back after a crash'),
  task('editing', 'open-the-same-file-in-two-panels', 'Open the same file in two panels', { panelTypes: ['editor'] }),
  task('editing', 'print-a-file', 'Print a file', { commands: ['editor.print'] }),
  task('finding', 'open-any-file-by-name', 'Open any file by name', { commands: ['navigate.quickOpen'] }),
  task('finding', 'find-and-replace-in-a-file', 'Find and replace in a file', { commands: ['search.find', 'search.findNext', 'search.findPrevious', 'search.replace', 'search.replaceCurrent', 'search.replaceAll', 'search.close'] }),
  task('finding', 'find-in-a-preview-or-a-terminal', 'Find in a preview or a terminal'),
  task('finding', 'search-the-whole-project', 'Search the whole project', { commands: ['search.findInFiles'], panelTypes: ['findInFiles'] }),
  task('finding', 'replace-across-files', 'Replace across files', { commands: ['search.replaceInFiles'] }),
  task('finding', 'narrow-a-search', 'Narrow a search'),
  task('previews', 'open-a-preview-of-a-file', 'Open a preview of a file', { commands: ['preview.open'], panelTypes: ['preview'] }),
  task('previews', 'choose-what-opens-when-you-open-a-file', 'Choose what opens when you open a file'),
  task('previews', 'keep-a-file-and-its-preview-in-step', 'Keep a file and its preview in step', { commands: ['preview.toggleSyncScroll'] }),
  task('previews', 'move-around-a-preview', 'Move around a preview', { commands: ['preview.goToHeading', 'preview.followLink', 'navigate.back', 'navigate.forward'] }),
  task('previews', 'copy-from-a-preview', 'Copy from a preview'),
  task('previews', 'print-a-preview-or-save-it-as-a-pdf', 'Print a preview or save it as a PDF', { commands: ['preview.print'] }),
  task('previews', 'when-a-preview-cannot-show-a-file', 'When a preview cannot show a file'),
  task('markdown', 'write-markdown-and-see-it-rendered', 'Write Markdown and see it rendered', { previewTypes: ['markdown'] }),
  task('markdown', 'tick-off-task-lists', 'Tick off task lists'),
  task('markdown', 'add-callouts', 'Add callouts'),
  task('markdown', 'write-maths', 'Write maths'),
  task('markdown', 'draw-diagrams-with-mermaid', 'Draw diagrams with Mermaid', { previewTypes: ['mermaid'] }),
  task('markdown', 'link-notes-together', 'Link notes together'),
  task('markdown', 'add-and-size-images', 'Add and size images'),
  task('markdown', 'show-front-matter', 'Show front matter'),
  task('csv-and-spreadsheets', 'edit-a-csv-file-as-a-grid', 'Edit a CSV file as a grid', { previewTypes: ['csv'] }),
  task('csv-and-spreadsheets', 'move-around-and-edit-cells', 'Move around and edit cells'),
  task('csv-and-spreadsheets', 'insert-rows-and-columns', 'Insert rows and columns', { commands: ['grid.insertRowAbove', 'grid.insertRowBelow', 'grid.insertColumnLeft', 'grid.insertColumnRight', 'grid.insertRowsAbove', 'grid.insertRowsBelow', 'grid.insertColumnsLeft', 'grid.insertColumnsRight', 'grid.deleteRows', 'grid.deleteColumns'] }),
  task('csv-and-spreadsheets', 'copy-and-paste-cells', 'Copy and paste cells'),
  task('csv-and-spreadsheets', 'set-column-widths-and-edit-long-cells', 'Set column widths and edit long cells'),
  task('csv-and-spreadsheets', 'keep-headers-in-view-and-wrap-text', 'Keep headers in view and wrap text'),
  task('csv-and-spreadsheets', 'fix-a-csv-that-will-not-parse', 'Fix a CSV that will not parse'),
  task('csv-and-spreadsheets', 'read-a-spreadsheet', 'Read a spreadsheet', { previewTypes: ['spreadsheet'] }),
  task('images-pdfs-svg-html', 'view-an-image', 'View an image', { previewTypes: ['image'] }),
  task('images-pdfs-svg-html', 'read-a-pdf', 'Read a PDF', { previewTypes: ['pdf'] }),
  task('images-pdfs-svg-html', 'view-an-svg', 'View an SVG', { previewTypes: ['svg'] }),
  task('images-pdfs-svg-html', 'preview-an-html-page', 'Preview an HTML page', { previewTypes: ['html'] }),
  task('images-pdfs-svg-html', 'allow-remote-content-in-an-html-preview', 'Allow remote content in an HTML preview'),
  task('preferences', 'open-preferences', 'Open Preferences', { commands: ['app.settings'] }),
  task('preferences', 'find-a-setting', 'Find a setting'),
  task('preferences', 'change-a-setting', 'Change a setting'),
  task('preferences', 'undo-a-change-or-go-back-to-the-default', 'Undo a change, or go back to the default'),
  task('preferences', 'edit-lists-and-tables', 'Edit lists and tables'),
  task('preferences', 'edit-the-settings-as-json', 'Edit the settings as JSON'),
  task('preferences', 'edit-config-files-by-hand', 'Edit config files by hand'),
  task('preferences', 'what-happens-to-your-settings-on-upgrade', 'What happens to your settings on upgrade'),
  task('preferences', 'choose-whether-throng-asks-before-opening-a-link', 'Choose whether throng asks before opening a link', {
    settings: ['confirmations.openExternalLink'],
  }),
  task('themes-and-icons', 'choose-a-theme', 'Choose a theme'),
  task('themes-and-icons', 'make-your-own-theme', 'Make your own theme'),
  task('themes-and-icons', 'check-a-theme-is-readable', 'Check a theme is readable'),
  task('themes-and-icons', 'choose-and-customise-icons', 'Choose and customise icons'),
  task('key-bindings', 'find-the-shortcut-for-something', 'Find the shortcut for something'),
  task('key-bindings', 'change-a-shortcut', 'Change a shortcut'),
  task('key-bindings', 'use-two-key-chords', 'Use two-key chords'),
  task('key-bindings', 'know-which-keys-always-reach-your-shell', 'Know which keys always reach your shell'),
  task('resources', 'find-your-way-around-the-resource-monitor', 'Find your way around the Resource Monitor'),
  task('resources', 'see-what-throng-is-using', 'See what throng is using'),
  task('resources', 'find-what-is-using-the-most', 'Find what is using the most', { commands: ['view.resourceMonitor'] }),
  task('resources', 'stop-something-that-is-running-away', 'Stop something that is running away'),
  task('resources', 'choose-what-the-list-shows', 'Choose what the list shows'),
  task('resources', 'see-which-folders-throng-is-holding', 'See which folders throng is holding'),
  task('resources', 'read-the-figures', 'Read the figures'),
  task('troubleshooting', 'the-background-service-has-stopped', 'The background service has stopped'),
  task('troubleshooting', 'a-terminal-will-not-start', 'A terminal will not start'),
  task('troubleshooting', 'a-file-will-not-move-rename-or-delete', 'A file will not move, rename or delete'),
  task('troubleshooting', 'live-updates-stopped-linux', 'Live updates stopped (Linux)'),
  task('troubleshooting', 'throng-says-another-copy-is-running', 'throng says another copy is running'),
  task('troubleshooting', 'throng-says-a-newer-version-is-installed', 'throng says a newer version is installed'),
  task('troubleshooting', 'throng-will-not-start-as-root', 'throng will not start as root'),
  task('troubleshooting', 'find-the-logs', 'Find the logs'),
  task('troubleshooting', 'report-a-problem', 'Report a problem'),
  task('faq', 'does-throng-update-itself', 'Does throng update itself?'),
  task('faq', 'are-my-files-deleted-when-i-remove-a-project', 'Are my files deleted when I remove a project?'),
  task('faq', 'do-terminals-keep-running-when-i-close-throng', 'Do terminals keep running when I close throng?'),
  task('faq', 'where-are-my-settings', 'Where are my settings?'),
  task('faq', 'can-i-run-several-copies-of-throng', 'Can I run several copies of throng?'),
  task('faq', 'what-is-a-sub-workspace', 'What is a sub-workspace?'),
  task('faq', 'why-does-ctrlc-not-copy-in-a-terminal', 'Why does Ctrl+C not copy in a terminal?'),
];

/** What the app has that no user task covers, and why. */
export const GUIDE_EXCLUSIONS: readonly GuideExclusion[] = [];
