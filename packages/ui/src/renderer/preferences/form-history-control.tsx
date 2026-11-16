/**
 * Clearing the remembered terminal-form values (067 FR-064b, FR-066).
 *
 * Two controls beside the history's own on/off and size settings: forget one terminal type's remembered
 * Startup Commands and Shell Arguments, or forget every type's at once. Both work whether the history is
 * on or off, since switching it off keeps what is stored (FR-064a) and the user must still be able to
 * wipe it. The values themselves are never listed here: this window clears, the terminal form offers.
 */
import { useId, useState, type ReactElement } from 'react';
import { useNotify } from '../common/notification.js';
import { useFlavours } from '../panel-type/use-flavours.js';
import { IconButton } from '../common/icon-button.js';
import { ROW_ACTION_TOKENS } from './row-action-tokens.js';

export function FormHistoryControl(): ReactElement | null {
  const api = window.throng?.formHistory;
  const flavours = useFlavours();
  const { notify } = useNotify();
  const nameId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const flavourId = chosen ?? flavours[0]?.value ?? '';
  const flavour = flavours.find((f) => f.value === flavourId);

  if (!api) return null;

  return (
    <div className="settings-row" data-testid="setting-form-history-clear">
      <div className="settings-row__meta">
        <label className="settings-row__label" id={nameId}>
          Remembered terminal values
        </label>
        <p className="settings-row__desc">
          Forget the Startup Commands and Shell Arguments the terminal form offers. This works whether the history is on
          or off.
        </p>
      </div>
      <div className="settings-row__control settings-row__control--inline">
        <select
          className="ctl ctl--select"
          data-testid="form-history-flavour"
          aria-label="Terminal type to clear"
          value={flavourId}
          disabled={flavours.length === 0}
          onChange={(e) => setChosen(e.target.value)}
        >
          {flavours.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {/* 069 FR-054 (#639) — action controls are themed icons with hover titles (constitution), not the
            browser's own text buttons. */}
        <IconButton
          token={ROW_ACTION_TOKENS.clear}
          testId="form-history-clear-flavour"
          title="Clear the values remembered for the selected terminal type"
          disabled={flavourId === ''}
          onClick={() => {
            api.clearFlavour(flavourId);
            notify({
              severity: 'info',
              subject: { kind: 'none' },
              action: 'clear remembered values',
              message: `The values remembered for ${flavour?.label ?? 'that terminal type'} were cleared.`,
              testId: 'form-history-cleared',
            });
          }}
        />
        <IconButton
          token="dismissAll"
          testId="form-history-clear-all"
          title="Clear the remembered values of all terminal types"
          onClick={() => {
            api.clearAll();
            notify({
              severity: 'info',
              subject: { kind: 'none' },
              action: 'clear remembered values',
              message: 'The values remembered for every terminal type were cleared.',
              testId: 'form-history-cleared',
            });
          }}
        />
      </div>
    </div>
  );
}
