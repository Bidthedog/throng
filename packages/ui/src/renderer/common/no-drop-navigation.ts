import { useEffect } from 'react';

/**
 * Stop a stray file drop from destroying the running application (018 / US9, FR-061a).
 *
 * THIS IS THE ONE THAT WOULD HAVE BEEN CATASTROPHIC. Drop a file anywhere that is not a drop target —
 * the title bar, the sidebar, the status bar, the gap between panels — and the browser engine's DEFAULT
 * behaviour is to NAVIGATE TO IT: the renderer replaces the entire running workspace with a view of the
 * dropped file. Every terminal, every unsaved buffer, the whole layout — gone, with no way back. Nothing
 * in the application prevented this before US9, because before US9 nothing invited the user to drag a
 * file at Throng in the first place.
 *
 * It is a RENDERER `preventDefault`, deliberately, and not a main-process `will-navigate` handler: this
 * stops the default BEFORE it becomes a navigation, rather than catching a navigation that has already
 * begun. Mounted by every window kind's app: the main window and every sub-workspace window (through the
 * composition root), Preferences, About and the Resource Monitor. Its own module, so a window that is not
 * the main window can mount it without loading the main window's app (055 SC-002).
 */
export function useNoDropNavigation(): void {
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent): void => {
      // A drop target that wants the file has already called preventDefault and stopped propagation, so
      // by the time an event reaches here it landed on nothing. Refuse the navigation, silently — the
      // user aimed at nothing in particular and expects nothing in particular to happen.
      // A `dragover` no target claimed also shows the "no entry" cursor (050 FR-034, R17) — the drop
      // would do nothing, and the cursor should say so. A claiming target has already called
      // preventDefault, and its own effect (an editor's `copy`) must stand untouched.
      const unclaimed = !e.defaultPrevented;
      e.preventDefault();
      if (e.type === 'dragover' && unclaimed && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);
}
