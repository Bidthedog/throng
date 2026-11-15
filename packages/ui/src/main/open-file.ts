/**
 * macOS's `open-file` (070 FR-024, research R19): a folder dropped on throng's Dock icon, or opened with Finder's
 * Open With, arrives as this event — before `ready` when it is what launched throng, so it is registered at module
 * scope. `Info.plist` declares folders only (`CFBundleDocumentTypes`, `public.folder`, role Viewer), but a file can
 * still be dropped on the icon; throng opens folders as projects, so a file is ignored. The event is always claimed
 * (`preventDefault`), which is how an app tells macOS it handled the open.
 */
export function openFileHandler(deps: {
  readonly kindOf: (absPath: string) => 'folder' | 'file' | 'missing';
  /** The open-folder queue (067): delivered once the main window's renderer is ready. */
  readonly push: (absPath: string) => void;
  /** Show the main window, hidden by a close (FR-028) or behind another app. */
  readonly bringForward: () => void;
}): (event: { preventDefault(): void }, absPath: string) => void {
  return (event, absPath) => {
    event.preventDefault();
    if (deps.kindOf(absPath) !== 'folder') return;
    deps.push(absPath);
    deps.bringForward();
  };
}
