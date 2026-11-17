throng icon sets
================

This folder holds your icon sets. throng rewrites this file at every start, so changes you make to
it are lost; keep your own notes elsewhere.

An icon set is a folder in this folder. It holds one SVG file for each icon it replaces, named after
the icon's key: for example, save.svg replaces the Save icon. A file being there is all it takes: there
is no list to update. Any icon a set does not replace is drawn from throng's default set, which is
called "throng", is built into the app and cannot be changed. This is also true of icons a later
version of throng adds or redraws.

Each theme uses one icon set. Every theme starts on the default set.


Make a set
----------

1. In throng, open Preferences and choose the Themes tab, then the Icons area.
2. Choose New set from this set, beside the set picker, and type a name.
   A set made from the default set starts empty. A set made from one of your own starts with a copy of
   its files. The current theme switches to the new set.
3. A name is refused, with the reason beside the name box, if it is "throng", if another set already has
   it (capital letters do not count as a difference), if it ends in .bak or .bak.<number>, or if your
   operating system could not use it as a folder name.


Replace an icon
---------------

The Icons area lists every icon as a read-only row: the icon, its key, its file name and what it is for.
Rows your set replaces are marked as overridden. throng has no icon editor; icons are edited outside
throng, in any program that edits SVG files.

1. Choose Override this icon on a row. throng copies the default art for that key into your set's folder
   as <key>.svg. If that file is already there, throng asks before it replaces it, and cancelling
   leaves the file exactly as it was.
2. Choose the open folder button beside the set to open the set's folder.
3. Edit the file, or replace it with your own SVG. You can also copy a file with the right name straight
   into the folder without using Override this icon.
4. To go back to the default art for that icon, choose Reset this icon to the default on its row. The
   file goes to your operating system's trash.

An icon takes its colour from the theme, so draw it with the colour "currentColor" rather than a fixed
colour. A file throng cannot read, or that is not an SVG, is ignored, and the row says why. Files in
the folder that match no key are listed as unrecognised and have no effect.


Rename or delete a set, or change a file
----------------------------------------

Rename this icon set and Delete this icon set sit beside the set picker while one of your sets is
picked. A rename takes every theme using the set along with it. A deleted set's folder goes to your
operating system's trash, and every theme that used it draws the default set again.

You can also delete an override file, rename it or replace it from outside throng at any time. Deleting
<key>.svg makes that icon come from the default set again. Deleting the whole folder removes the set.


See your changes
----------------

throng does not watch these folders. It reads every set again when it starts, and whenever you use any
of the icon set controls in Preferences: picking a set, the buttons beside the picker, and Override and
Reset on an icon. Reload the icon sets from disk, beside the picker, does only that.


When throng ships new or redrawn icons
--------------------------------------

Every override file in your set is kept, and still wins for its key. Every key your set does not replace
shows the newly shipped art. A key throng adds later appears in the list below; to change it, add a
file named after it.


Folders ending in .bak
----------------------

When throng moved to this kind of icon set, nothing from the older icon sets was converted: no glyph
maps, no per-theme icon overrides, no manifest files. Each older folder here was renamed with .bak added
to its name (or .bak.2, .bak.3 and so on where that name was taken), with its contents untouched. The
two folders earlier versions seeded, "throng" and "throng-svg", were deleted if you had never changed
them and renamed if you had. throng does not show .bak folders as sets, and it raises a notice at every
start while any remain.

To keep an icon from a backup:

1. Make a new set, as above.
2. Open the .bak folder and your new set's folder side by side.
3. Copy the .svg files you want into the new set, named <key>.svg using the keys listed below. Old files
   named after an older key may not match any key now; rename them, or leave them.
4. Choose Reload the icon sets from disk.
5. When you have what you want, delete the .bak folders, or move them out of this folder. The notice
   stops once no .bak folder is left.


Every icon key
--------------

Each line is the file name that replaces the icon, then what the icon is for.

---- icon keys: begin ----
destroy.svg - The icon on the control that permanently closes and discards a terminal, panel, or project, and on the Icons row control that deletes your icon set.
deleteFile.svg - The icon on the File Explorer’s Delete, in its toolbar and its menu, which deletes the selected files and folders — to the OS trash, or for good, as Preferences say.
dismiss.svg - The icon on the control that clears a transient message such as an error bar or notice, without destroying anything.
cancel.svg - The icon on the control that stops a running operation, such as cancelling a paste in progress.
collapse.svg - The icon on the control that folds a pane or section closed.
expand.svg - The icon on the control that opens a collapsed pane or section.
rename.svg - The icon on the control that starts editing the name of a project, tab, panel, or your icon set.
send.svg - The icon on the control that submits the typed input to its target.
tab.svg - The icon that marks a workspace tab.
add.svg - The icon on the control that creates a new tab, terminal, or entry.
save.svg - The icon on the editor title bar button that saves the document.
saveAs.svg - The icon on the editor title bar button that saves the document under a new name.
dismissAll.svg - The icon on the Notifications panel control that dismisses every notification at once.
sortOrder.svg - The icon on the Notifications panel control that chooses the order notifications are listed in.
minimisePanel.svg - The icon on every control that hides a side pane or minimises a side panel: the side panes' hide buttons, and the Minimise button and menu item of the Notifications and Sub-workspaces panels. Draw it pointing down; throng turns it to face the edge the pane or panel collapses toward.
restorePanel.svg - The icon on every control that shows a hidden side pane or restores a minimised side panel: the side panes' show buttons, and the Restore button and menu item of the Notifications and Sub-workspaces panels. Draw it pointing up; throng turns it to face the way the pane or panel opens.
noticeError.svg - The icon at the top left of an error entry in the Notifications panel, before its title.
noticeAttention.svg - The icon at the top left of an attention entry in the Notifications panel, before its title.
noticeInfo.svg - The icon at the top left of an information entry in the Notifications panel, before its title.
noticeSuccess.svg - The icon at the top left of a success entry in the Notifications panel, before its title. A warning entry draws the Warning icon.
detach.svg - The icon on the control that tears a tab or panel out into its own window.
retry.svg - The icon on the control that re-runs a failed or interrupted action, such as reconnecting a dropped terminal session.
restoreAll.svg - The icon on the control that returns every built-in theme to the values it was shipped with, leaving your own themes untouched.
revert.svg - The icon on the control that undoes your changes to a single preference, putting it back to the value it had when you opened this window — which is not necessarily the value Throng ships with.
editJson.svg - The icon on the preferences toggle that swaps the visual editor for the raw configuration text, so you can type the underlying values by hand.
editVisual.svg - The icon on the preferences toggle that swaps the raw configuration text back for the visual editor, with its labelled rows and controls.
moveUp.svg - The icon on the control that moves an entry one place earlier in a list you are editing, such as a folder-exclusion rule.
moveDown.svg - The icon on the control that moves an entry one place later in a list you are editing, such as a folder-exclusion rule.
zoomIn.svg - The icon on the panel menu control that enlarges that panel’s text.
zoomOut.svg - The icon on the panel menu control that shrinks that panel’s text.
zoomReset.svg - The icon on the panel menu control that returns that panel’s text to its default size.
folder.svg - The icon shown beside a closed folder in the File Explorer tree.
folderOpen.svg - The icon shown beside an expanded folder in the File Explorer tree.
chevron.svg - The small arrow that twists to reveal or hide a folder's children in the tree.
file.svg - The icon shown beside an ordinary file in the tree.
fileCode.svg - The icon shown beside a source-code file in the tree.
fileJson.svg - The icon shown beside a structured-data file in the tree.
fileMarkdown.svg - The icon shown beside a Markdown document in the tree.
fileImage.svg - The icon shown beside an image file in the tree.
fileText.svg - The icon shown beside a plain-text file in the tree.
symlink.svg - The badge marking a tree entry that points to another location.
fileArchive.svg - The icon shown beside a compressed archive in the tree, such as a zip or tar file.
fileShell.svg - The icon shown beside a shell or batch script in the tree.
fileConfig.svg - The icon shown beside a configuration file in the tree, such as YAML, TOML, an INI file or a dotfile.
fileSpreadsheet.svg - The icon shown beside a spreadsheet or table of values in the tree, such as a CSV file.
fileDatabase.svg - The icon shown beside a database or SQL file in the tree.
fileDiff.svg - The icon shown beside a diff or patch file in the tree.
fileKey.svg - The icon shown beside a key or certificate file in the tree.
fileAudio.svg - The icon shown beside a sound file in the tree.
fileVideo.svg - The icon shown beside a video file in the tree.
fileFont.svg - The icon shown beside a font file in the tree.
fileModel.svg - The icon shown beside a three-dimensional model file in the tree.
filePackage.svg - The icon shown beside an installer or software package in the tree.
folderSymlink.svg - The badge marking a folder in the tree that points to another location.
folderGit.svg - The icon shown beside a Git repository folder in the tree.
folderConfig.svg - The icon shown beside a folder of editor or tool settings in the tree, such as .vscode or .github.
folderDependencies.svg - The icon shown beside a folder of installed dependencies in the tree, such as node_modules.
fileC.svg - The icon shown beside a C source file in the tree.
fileCpp.svg - The icon shown beside a C++ source file in the tree.
fileCsharp.svg - The icon shown beside a C# source file in the tree.
fileJava.svg - The icon shown beside a Java source file in the tree.
fileJavaScript.svg - The icon shown beside a JavaScript source file in the tree.
fileTypeScript.svg - The icon shown beside a TypeScript source file in the tree.
filePython.svg - The icon shown beside a Python source file in the tree.
fileGo.svg - The icon shown beside a Go source file in the tree.
fileRust.svg - The icon shown beside a Rust source file in the tree.
fileRuby.svg - The icon shown beside a Ruby source file in the tree.
fileR.svg - The icon shown beside a R source file in the tree.
fileLua.svg - The icon shown beside a Lua source file in the tree.
fileDart.svg - The icon shown beside a Dart source file in the tree.
fileSwift.svg - The icon shown beside a Swift source file in the tree.
fileScala.svg - The icon shown beside a Scala source file in the tree.
fileKotlin.svg - The icon shown beside a Kotlin source file in the tree.
filePhp.svg - The icon shown beside a PHP source file in the tree.
fileSql.svg - The icon shown beside a SQL source file in the tree.
fileHtml.svg - The icon shown beside a HTML source file in the tree.
fileCss.svg - The icon shown beside a CSS source file in the tree.
fileSass.svg - The icon shown beside a Sass source file in the tree.
filePowerShell.svg - The icon shown beside a PowerShell source file in the tree.
editorPanel.svg - The icon at the head of an editor panel’s title marking it as a text editor.
expandAll.svg - The icon on the toolbar control that opens every folder in the tree, and on the Preferences control that unfolds every section.
collapseAll.svg - The icon on the toolbar control that folds every folder in the tree closed, and on the Preferences control that folds every section.
newFolder.svg - The icon on the toolbar control that creates a folder in the tree.
quickOpen.svg - The icon on the toolbar control that opens any file in the project by typing part of its path.
terminal.svg - The icon that marks a terminal panel or a new-terminal control.
search.svg - The icon on the control that opens the find bar over the active panel.
findNext.svg - The icon on the control that steps forward to the following match.
findPrevious.svg - The icon on the control that steps back to the preceding match.
findInFiles.svg - The icon on the toolbar control and folder menu item that searches every file in the project for a piece of text.
searchScope.svg - The icon on the control that shows which folders and files a Find in Files search is looking through, and lets you change them.
matchCase.svg - The icon on the toggle that makes the search distinguish capital letters from small ones.
wholeWord.svg - The icon on the toggle that restricts the search to complete words rather than fragments.
replace.svg - The icon on the control that swaps the current match for the replacement text.
replaceAll.svg - The icon on the control that swaps every match for the replacement text at once.
settings.svg - The gear that opens preferences from the title bar, and a project’s own options from its pane.
windowMinimise.svg - The icon on the control that drops a window out of sight without closing it.
windowMaximise.svg - The icon on the control that grows a window to fill the whole display.
windowRestore.svg - The icon on the control that brings a filled window back to the size it was before.
windowClose.svg - The icon on the control that shuts a window for good.
cut.svg - The icon on the menu row that lifts the selected text or files onto the clipboard and removes them from where they were.
copy.svg - The icon on the menu row that places the selected text or files onto the clipboard, leaving the originals in place.
paste.svg - The icon on the menu row that drops whatever the clipboard holds in at the cursor or the chosen folder.
selectAll.svg - The icon on the menu row that highlights the whole document at once, ready to act on together.
undo.svg - The icon on the editor menu row that steps the last change back out of the document.
redo.svg - The icon on the editor menu row that reapplies a change you had just stepped back out.
language.svg - The icon on the editor menu row that opens the picker for which language colours and folds the file.
keybindings.svg - The icon on the title-bar menu row that opens the editor for the keyboard shortcuts you can rebind.
themes.svg - The icon on the title-bar menu row that opens the editor for the colours, fonts, and icons the app wears.
about.svg - The icon on the title-bar menu row that opens the window naming the release and its build details.
hide.svg - The icon on the tree menu row that drops a file or folder out of view for this project only.
showHidden.svg - The icon on the Quick Open control that brings the files this project hides back into the list, for that one search.
resourceMonitor.svg - The icon on the status-bar item that shows throng's CPU, memory, GPU and I/O, and on the title-bar menu row that opens the Resource Monitor.
resourceCpu.svg - The icon beside the CPU figure in the status bar, and on the Resource Monitor's "show by CPU" choice.
resourceMemory.svg - The icon beside the memory figure in the status bar, and on the Resource Monitor's "show by memory" choice.
resourceGpu.svg - The icon beside the GPU figure in the status bar, and on the Resource Monitor's "show by GPU" choice.
resourceIo.svg - The icon beside the I/O figure in the status bar, and on the Resource Monitor's "show by I/O" choice.
resourceHideIdle.svg - The icon on the Resource Monitor control that hides processes doing nothing.
resourceKill.svg - The icon on the Resource Monitor row that ends one process.
resourceKillBelow.svg - The icon on the Resource Monitor row that ends every process beneath a project, tab, panel or process.
chevronLeft.svg - The icon on the control at the left end of the tab strip that brings the tabs hidden off that edge back into view.
chevronRight.svg - The icon on the control at the right end of the tab strip that brings the tabs hidden off that edge back into view.
chevronDown.svg - The icon on the tab strip control that drops open a searchable list of every tab in the window, however many are on screen.
preview.svg - The icon on the editor status bar button and menu rows that open a rendered, read-only view of a file such as a Markdown document, and at the head of that preview panel’s title.
refresh.svg - The icon on the preview panel menu row that reads the file or its open document again and redraws the preview straight away.
navigateBack.svg - The icon on the button at the top left of an editor or preview panel, and its menu row, that returns the panel to the file it showed before.
navigateForward.svg - The icon on the button at the top left of an editor or preview panel, and its menu row, that moves the panel on again to a file you stepped back from.
syncScroll.svg - The icon on the Synchronise Scrolling button on the editor's and the preview's status bars, and on the Synchronise Scrolling menu rows, that turns scrolling an editor and its preview together on or off.
unload.svg - The icon on a project's two Unload context-menu rows, which detach it from the window without deleting anything on disk.
category.svg - The icon on a project's Move to Category context-menu row, which reassigns it to a different category.
foldSectionExpanded.svg - The marker on an expanded heading's line in a Markdown editor's fold gutter. Clicking it collapses the section.
foldSectionCollapsed.svg - The marker on a collapsed heading's line in a Markdown editor's fold gutter. Clicking it expands the section.
foldPreviewExpanded.svg - The disclosure triangle beside an expanded heading in a Markdown preview’s fold gutter. Clicking it collapses the section.
foldPreviewCollapsed.svg - The disclosure triangle beside a collapsed heading in a Markdown preview’s fold gutter. Clicking it expands the section.
panelMaximise.svg - The icon on a panel header's Maximise button and its menu row, which puts the panel in Focus Mode: it fills its tab's middle section until it is restored.
panelRestore.svg - The icon on the Exit Focus Mode control of a panel or a diagram in Focus Mode, which puts it back where it was.
diagramFit.svg - The icon on a diagram's Fit control, which shrinks the diagram to fit the width of its box.
diagramZoomReset.svg - The icon on a diagram's Zoom 100% control, which shows the diagram at its actual size, between the zoom-out and zoom-in controls.
diagramFullPane.svg - The icon on a diagram's Enter Focus Mode control, which fills the whole middle section with the diagram and hides the side panes until you leave Focus Mode.
warning.svg - The marker on a folded Preferences section or subsection that hides a setting holding an invalid entry.
whitespace.svg - The icon on the editor status bar toggle that shows or hides a symbol for every space, tab, line break and invisible character.
busy.svg - The icon on the Find in Files cancel control while a search is running. It turns while the search runs; clicking it cancels.
groupFolderTree.svg - The icon on the Find in Files control that arranges results in the File Explorer’s folder tree.
projectSettings.svg - The icon on the File Explorer control that opens the active project’s settings — what it hides from the tree and from Find in Files.
searchExclusions.svg - The icon on the Find in Files toggle that switches the search exclusion list on or off for that panel.
help.svg - The icon on the Resource Monitor control that explains what it shows and how to use it.
activate.svg - The icon on the Resource Monitor control that goes to the project, tab or panel a row names, bringing its window forward.
resourceHideEnded.svg - The icon on the Resource Monitor control that hides processes that have ended.
resourceNetwork.svg - The icon on the Resource Monitor's "order by Network" choice.
dragHandle.svg - The icon on the handle you drag to move a project or sub-workspace to a new place in its list.
menuChecked.svg - The icon on a menu row whose option is switched on.
overrideIcon.svg - The icon on the Icons row control that copies the default icon into your icon set, ready for you to replace with your own file.
---- icon keys: end ----
