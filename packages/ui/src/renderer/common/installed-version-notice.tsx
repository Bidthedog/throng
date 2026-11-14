/**
 * The running-copy notice (063 FR-010), mounted once in the main window by `app.tsx`.
 *
 * A package upgrade leaves this window running from its own files. Main compares versions and pushes the facts here
 * once per installed version, so a repeat cannot stack. It is `sticky` (068 FR-021e) and stays until dismissed: FR-010
 * says the user must be told, and a timer could take it before they look. Its Restart is on the notice because it resolves the condition.
 */
import { useEffect, type ReactElement } from 'react';
import { installedVersionNoticeText } from '@throng/core';
import { IconButton } from './icon-button.js';
import { useNotify } from './notification.js';

const TEST_ID = 'installed-version-notice';
const ALWAYS_SHOWN = { toast: true, panel: false } as const;

export function InstalledVersionNotice(): null {
  const { notify } = useNotify();

  useEffect(() => {
    const instance = window.throng?.instance;
    if (!instance?.onInstalledVersion) return undefined;
    const off = instance.onInstalledVersion((payload) => {
      const restart: ReactElement = (
        <IconButton
          token="retry"
          className="notice__action"
          testId="installed-version-restart"
          title="Restart throng"
          onClick={() => instance.restartInstalled()}
        />
      );
      notify({
        severity: 'info',
        subject: { kind: 'none' },
        message: installedVersionNoticeText(payload),
        body: restart,
        testId: TEST_ID,
        instanceKey: payload.installedVersion,
        display: ALWAYS_SHOWN,
        sticky: true,
      });
    });
    instance.installedVersionReady();
    return off;
  }, [notify]);

  return null;
}
