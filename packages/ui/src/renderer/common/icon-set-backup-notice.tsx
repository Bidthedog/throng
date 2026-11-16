/**
 * The icon-set backup notice (069 FR-038), mounted once in the main window by `app.tsx`.
 *
 * An upgrade that finds icon-set folders from before the new format keeps them as backups rather than
 * converting them. Main tells the window how many it kept, once per start and only when there are any;
 * this raises one notice saying so, in core's words, with the Open folder control that resolves it. It
 * is `sticky` (068 FR-021e) and stays until dismissed: a timer could take it before the user looked.
 *
 * ONE notice, not one per event: a repeat carries the same `groupKey`, which the notification model
 * answers by flashing the card already there. A notice the user dismissed is raised again at the next
 * start, because main sends the event again then and the window starts with none.
 */
import { useEffect, type ReactElement } from 'react';
import { iconSetBackupNoticeText } from '@throng/core';
import { IconButton } from './icon-button.js';
import { useNotify } from './notification.js';
import { openIconSetsFolder } from './open-icon-sets-folder.js';

const TEST_ID = 'icon-set-backup-notice';
const GROUP_KEY = 'icon-set-backups';
const ALWAYS_SHOWN = { toast: true, panel: true } as const;

export function IconSetBackupNotice(): null {
  const { notify } = useNotify();

  useEffect(() => {
    const iconSets = window.throng?.iconSets;
    if (!iconSets?.onBackupsPresent) return undefined;
    const openFolder = (): void => {
      void openIconSetsFolder(notify);
    };
    const off = iconSets.onBackupsPresent(({ count }) => {
      const { title, message } = iconSetBackupNoticeText(count);
      const open: ReactElement = (
        <IconButton
          token="folderOpen"
          className="notice__control"
          testId="icon-set-backup-open-folder"
          title="Open the icon sets folder"
          onClick={openFolder}
        />
      );
      notify({
        severity: 'info',
        subject: { kind: 'none' },
        title,
        message,
        // The card's own control, beside Copy and Dismiss (constitution, toast controls).
        controls: open,
        testId: TEST_ID,
        groupKey: GROUP_KEY,
        panelActions: [{ kind: 'openIconSetsFolder', label: 'Open the icon sets folder' }],
        display: ALWAYS_SHOWN,
        sticky: true,
      });
    });
    // Only now: main holds the event until a window says it is listening (the installed-version handshake).
    iconSets.backupsReady();
    return off;
  }, [notify]);

  return null;
}
