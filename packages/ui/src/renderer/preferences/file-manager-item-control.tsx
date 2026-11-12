/**
 * The file manager's "Open as throng project" item, switched on or off from Preferences (067 FR-034).
 *
 * This is not a setting: the OS registration is the state, read with `status()` and written with
 * `setEnabled()`, so there is no stored value that could disagree with what the file manager shows.
 * Three things follow from that:
 *
 * - the toggle shows what `status()` (and, after a change, `setEnabled()`) ANSWERED, never what the user
 *   clicked: a change that did not take is not reported as made;
 * - a machine-wide Windows registration needs elevation to change, so the control is disabled and says
 *   so rather than offering a change it cannot make;
 * - a build that registers nothing (portable, archive) disables it with the reason (FR-036).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { logCaught, type FileManagerRegistration } from '@throng/core';
import { useNotify } from '../common/notification.js';

const LABEL = 'Show “Open as throng project” in the file manager';

export function FileManagerItemControl(): ReactElement | null {
  const { notify } = useNotify();
  const [registration, setRegistration] = useState<FileManagerRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const mounted = useRef(true);
  const api = window.throng?.fileManagerItem;

  useEffect(() => {
    mounted.current = true;
    void api
      ?.status()
      .then((state) => {
        if (mounted.current) setRegistration(state);
      })
      .catch((error: unknown) => logCaught('file-manager-item-control: read the registration', error));
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the bridge is read once, at mount
  }, []);

  const change = useCallback(
    async (wanted: boolean): Promise<void> => {
      if (!api || registration === null) return;
      // Only an elevated process could change these; offering the call would claim a change it cannot make.
      if (registration.state === 'machine-wide' || registration.state === 'unavailable') return;
      setBusy(true);
      const before = registration;
      let after: FileManagerRegistration = before;
      try {
        after = await api.setEnabled(wanted);
      } catch (error) {
        logCaught('file-manager-item-control: change the registration', error);
      }
      if (!mounted.current) return;
      setRegistration(after);
      setBusy(false);
      // What the OS now says, not what was asked for: if they differ the change was not made.
      const took = after.state === (wanted ? 'on' : 'off');
      if (!took && after.state !== 'machine-wide' && after.state !== 'unavailable') {
        notify({
          severity: 'error',
          subject: { kind: 'none' },
          action: 'change the file manager item',
          message: `It was not changed, and is still ${after.state}. The details are in the diagnostics log.`,
          testId: 'file-manager-item-error',
        });
      }
    },
    [api, registration, notify],
  );

  if (!api) return null;

  const fixed = registration?.state === 'machine-wide' || registration?.state === 'unavailable';
  const reason = registration !== null && 'reason' in registration ? registration.reason : null;
  const checked = registration?.state === 'on' || registration?.state === 'machine-wide';

  return (
    <div className="settings-row" data-testid="setting-file-manager-item">
      <div className="settings-row__meta">
        <label className="settings-row__label" htmlFor={`${reasonId}-toggle`}>
          {LABEL}
        </label>
        <p className="settings-row__desc">
          Adds “Open as throng project” to a folder’s context menu in your file manager, for this user. Turning it off
          here does not need the installer.
        </p>
        {reason !== null ? (
          <p className="settings-row__inert" id={reasonId} data-testid="file-manager-item-reason">
            {reason}
          </p>
        ) : null}
      </div>
      <div className="settings-row__control">
        <label className="ctl ctl--toggle">
          <input
            id={`${reasonId}-toggle`}
            type="checkbox"
            data-testid="file-manager-item-toggle"
            checked={checked}
            disabled={registration === null || fixed || busy}
            aria-describedby={reason !== null ? reasonId : undefined}
            onChange={(e) => void change(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}
