/**
 * Shared folder-picker control (011, US3, FR-042). One reusable component used at
 * two call sites: new-project creation and the settings "Override start folder".
 * It is an EDITABLE path field (the user may type, paste, and edit the path — a
 * path you cannot type is a path you cannot paste) plus a themeable browse icon
 * (hover title, theme-token colours per constitution v3.12.0) that opens the OS
 * folder dialog on demand.
 *
 * The ONLY difference between the two call sites is `autoOpenOnMount`: project
 * creation pops the OS dialog automatically when the form appears; the settings
 * control never opens a dialog on its own — only when the user clicks browse.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { Icon } from './icon.js';

export interface FolderPickerProps {
  /** The current path (editable). */
  value: string;
  /** Called on every edit (typing/paste) and when a folder is chosen via the dialog. */
  onChange: (path: string) => void;
  /** Called ONLY when a folder is chosen through the OS dialog (not on typing) — e.g.
   *  project creation auto-names from the picked folder. */
  onPick?: (path: string) => void;
  /** Called when the editable path input loses focus (e.g. the settings control
   *  commits a typed/pasted path on blur, mirroring the other text settings). */
  onBlur?: () => void;
  /** Pop the OS dialog automatically once when mounted (project creation). Default false. */
  autoOpenOnMount?: boolean;
  /** Fallback start folder(s) for the dialog when the field is empty. A list is an
   *  ordered cascade (the OS dialog opens at the first that resolves) — e.g. the
   *  new-project starting-folder candidates override -> last viewed -> profile. */
  defaultPath?: string | string[];
  /** Hover title / aria-label for the browse icon. */
  browseTitle?: string;
  placeholder?: string;
  inputClassName?: string;
  inputTestId?: string;
  browseTestId?: string;
}

export function FolderPicker({
  value,
  onChange,
  onPick,
  onBlur,
  autoOpenOnMount = false,
  defaultPath,
  browseTitle = 'Browse for folder',
  placeholder = 'Folder Selection',
  inputClassName,
  inputTestId,
  browseTestId,
}: FolderPickerProps): ReactElement {
  const opened = useRef(false);

  const browse = async (): Promise<void> => {
    const start = value.trim().length > 0 ? value : defaultPath;
    const dir = await window.throng?.pickFolder?.({ defaultPath: start });
    if (!dir) return;
    onChange(dir);
    onPick?.(dir);
  };

  // Project-creation call site only: pop the dialog once when the form appears.
  useEffect(() => {
    if (autoOpenOnMount && !opened.current) {
      opened.current = true;
      void browse();
    }
    // browse reads live props via closure; a mount-once effect is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenOnMount]);

  return (
    <div className="folder-picker">
      <input
        className={inputClassName ?? 'folder-picker__path'}
        data-testid={inputTestId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        className="folder-picker__browse"
        data-testid={browseTestId}
        title={browseTitle}
        aria-label={browseTitle}
        onClick={() => void browse()}
      >
        <Icon token="folderOpen" />
      </button>
    </div>
  );
}
