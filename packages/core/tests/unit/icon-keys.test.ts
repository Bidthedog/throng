import { describe, expect, it } from 'vitest';
import { ICON_KEYS, ICON_KEY_DESCRIPTIONS, containsAbbreviation, isIconKey } from '../../src/index.js';

/**
 * Spec 069 FR-010 to FR-012: the icon keys. The list is frozen here on purpose: adding, removing or
 * renaming a key is a change to every user icon set's file names, so it must be a deliberate edit
 * to this test as well as to the registry.
 */
const EXPECTED_KEYS = [
  'destroy', 'deleteFile', 'dismiss', 'cancel', 'collapse', 'expand', 'rename', 'send', 'tab', 'add', 'save',
  'saveAs', 'dismissAll', 'sortOrder', 'minimisePanel', 'restorePanel', 'noticeError',
  'noticeAttention', 'noticeInfo', 'noticeSuccess', 'detach', 'retry', 'restoreAll', 'revert',
  'editJson', 'editVisual', 'moveUp', 'moveDown', 'zoomIn', 'zoomOut', 'zoomReset', 'folder',
  'folderOpen', 'chevron', 'file', 'fileCode', 'fileJson', 'fileMarkdown', 'fileImage', 'fileText',
  'symlink', 'fileArchive', 'fileShell', 'fileConfig', 'fileSpreadsheet', 'fileDatabase', 'fileDiff', 'fileKey', 'fileAudio', 'fileVideo', 'fileFont', 'fileModel', 'filePackage', 'folderSymlink', 'folderGit', 'folderConfig', 'folderDependencies',
  'fileC', 'fileCpp', 'fileCsharp', 'fileJava', 'fileJavaScript', 'fileTypeScript', 'filePython', 'fileGo', 'fileRust', 'fileRuby', 'fileR', 'fileLua', 'fileDart', 'fileSwift', 'fileScala', 'fileKotlin', 'filePhp', 'fileSql', 'fileHtml', 'fileCss', 'fileSass', 'filePowerShell',
  'editorPanel', 'expandAll', 'collapseAll', 'newFolder', 'quickOpen', 'terminal',
  'search', 'findNext', 'findPrevious', 'findInFiles', 'searchScope', 'matchCase', 'wholeWord',
  'replace', 'replaceAll', 'settings', 'windowMinimise', 'windowMaximise', 'windowRestore',
  'windowClose', 'cut', 'copy', 'paste', 'selectAll', 'undo', 'redo', 'language', 'keybindings',
  'themes', 'about', 'hide', 'showHidden', 'resourceMonitor', 'resourceCpu', 'resourceMemory',
  'resourceGpu', 'resourceIo', 'resourceHideIdle', 'resourceKill', 'resourceKillBelow',
  'chevronLeft', 'chevronRight', 'chevronDown', 'preview',
  // 074 FR-103: each shipped preview type's own preview icon.
  'previewMarkdown', 'previewMermaid', 'previewImage', 'previewSvg', 'previewPdf', 'previewHtml',
  // 073 under 074 FR-103: the CSV and Spreadsheet preview icons.
  'previewCsv', 'previewSpreadsheet',
  'refresh', 'navigateBack',
  'navigateForward', 'syncScroll', 'unload', 'category', 'foldSectionExpanded',
  'foldSectionCollapsed', 'foldPreviewExpanded', 'foldPreviewCollapsed', 'panelMaximise',
  'panelRestore', 'diagramFit', 'diagramZoomReset', 'diagramFullPane', 'pageLayoutSingle', 'pageLayoutTwo', 'pageLayoutWrap', 'warning', 'whitespace',
  'busy', 'groupFolderTree', 'projectSettings', 'searchExclusions', 'help', 'activate',
  'resourceHideEnded', 'resourceNetwork', 'dragHandle', 'menuChecked', 'overrideIcon',
  // 076 FR-002: the terminal status bar's three per-panel toggles.
  'rememberCommand', 'rememberDirectory', 'terminalNotifications',
  'cellDialog',
  'insertRowAbove', 'insertRowBelow', 'insertColumnLeft', 'insertColumnRight', 'resetColumnWidth', 'goToRow', 'wrapCells', 'lockFirstRow', 'lockFirstColumn', 'readOnly',
  // 075 FR-024 — one per canonical callout type.
  'calloutNote', 'calloutAbstract', 'calloutInfo', 'calloutTodo', 'calloutTip', 'calloutSuccess', 'calloutQuestion',
  'calloutWarning', 'calloutFailure', 'calloutDanger', 'calloutBug', 'calloutExample', 'calloutQuote',
  // 075 — Print… and Print Preview's Print button, and FR-068a's Back and Forward through its pages.
  'print', 'pagePrevious', 'pageNext',
  // 078 FR-013 — the Themes picker's WCAG AA mark.
  'wcagConformant',
];

describe('icon keys (069 FR-010 to FR-012)', () => {
  // 069 FR-055 added `deleteFile`: the File Explorer's Delete as a rubbish bin, apart from `destroy`'s ✕.
  // 069 FR-056 added the sixteen file and folder kinds Lucide draws that the tree did not.
  // 069 FR-057 added a key per common programming language.
  // 074 FR-062c added a PDF preview's three page layouts: `pageLayoutSingle`, `pageLayoutTwo`, `pageLayoutWrap`.
  // 074 FR-103 added a preview icon per shipped preview type, beside `preview`.
  // 075 FR-024 added the thirteen callout icons, FR-063 `print`, and FR-068a `pagePrevious` and `pageNext`.
  // 078 FR-013 added `wcagConformant`, the Themes picker's mark for a theme that meets WCAG AA.
  it('is the 193 keys: the 110 of 068, without the dead `notifications`, plus forty-two from 069, three from 076, thirteen from 073 (the CSV cell dialog toggle, the grid menu icons, the CSV and Spreadsheet preview icons and the workbook Read-only marker), nine from 074, sixteen from 075 and one from 078', () => {
    expect([...ICON_KEYS]).toEqual(EXPECTED_KEYS);
    expect(ICON_KEYS).toHaveLength(193);
    expect(ICON_KEYS).not.toContain('notifications');
  });

  it('names every key once, in camelCase, so it is a safe file name on every OS', () => {
    expect(new Set(ICON_KEYS).size).toBe(ICON_KEYS.length);
    for (const key of ICON_KEYS) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it('describes every key, and no other, in plain words about icons rather than glyphs (FR-012)', () => {
    expect(Object.keys(ICON_KEY_DESCRIPTIONS).sort()).toEqual([...ICON_KEYS].sort());
    for (const key of ICON_KEYS) {
      const text = ICON_KEY_DESCRIPTIONS[key];
      expect(text.trim().length, key).toBeGreaterThan(10);
      expect(text, key).toMatch(/\.$/);
      expect(text, key).not.toMatch(/\bglyphs?\b/i);
      expect(containsAbbreviation(text), key).toBe(false);
    }
  });

  it('tells a key from any other string', () => {
    expect(isIconKey('save')).toBe(true);
    expect(isIconKey('notifications')).toBe(false);
    expect(isIconKey('save.svg')).toBe(false);
  });
});
