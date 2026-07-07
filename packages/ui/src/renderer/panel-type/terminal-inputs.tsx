import type { ReactElement } from 'react';
import type { FlavourOption, PanelTypeValues } from '@throng/core';

/**
 * The Terminal panel type's inputs (005 / US2 config half): a **Flavour** dropdown
 * and a **Startup Params** free-text field (FR-010/011). Selecting a flavour
 * repopulates Startup Params with that flavour's default (FR-012). The flavour
 * list is supplied by the form (stub in Phase A, machine-detected in Phase B).
 */
export function TerminalInputs({
  values,
  flavours,
  elevated,
  onChange,
}: {
  values: PanelTypeValues;
  flavours: readonly FlavourOption[];
  /** Whether the terminal-hosting daemon is elevated — gates "run as admin" (FR-025a). */
  elevated: boolean;
  onChange: (next: PanelTypeValues) => void;
}): ReactElement {
  const selectFlavour = (value: string): void => {
    const flavour = flavours.find((f) => f.value === value);
    onChange({ ...values, flavourId: value, params: flavour?.defaultParams ?? '' });
  };
  const runAsAdmin = values.runAsAdmin === 'true';

  return (
    <div className="panel-type-form__inputs" data-testid="terminal-inputs">
      <label className="panel-type-form__field">
        <span>Flavour</span>
        {flavours.length === 0 ? (
          <span className="panel-type-form__empty" data-testid="terminal-no-flavours">
            No shells detected on this machine
          </span>
        ) : (
          <select
            data-testid="terminal-flavour"
            value={values.flavourId ?? ''}
            onChange={(e) => selectFlavour(e.target.value)}
          >
            {flavours.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="panel-type-form__field">
        <span>Startup Params</span>
        <input
          type="text"
          data-testid="terminal-params"
          value={values.params ?? ''}
          onChange={(e) => onChange({ ...values, params: e.target.value })}
        />
      </label>
      <label
        className="panel-type-form__check"
        title={
          elevated
            ? 'Run this terminal elevated ("as administrator")'
            : 'Relaunch throng as administrator to enable admin terminals'
        }
      >
        <input
          type="checkbox"
          data-testid="terminal-admin"
          checked={runAsAdmin}
          disabled={!elevated}
          onChange={(e) => onChange({ ...values, runAsAdmin: e.target.checked ? 'true' : 'false' })}
        />
        <span>Run as administrator</span>
      </label>
    </div>
  );
}
