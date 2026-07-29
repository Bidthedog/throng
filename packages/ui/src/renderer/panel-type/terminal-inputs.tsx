import type { ReactElement } from 'react';
import type { FlavourOption, PanelTypeValues } from '@throng/core';

/**
 * The Terminal panel type's inputs (005 / US2 config half): a **Flavour** dropdown
 * and a **Shell Arguments** free-text field (FR-010/011). Selecting a flavour
 * repopulates Shell Arguments with that flavour's default (FR-012). The flavour
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
    onChange({ ...values, flavourId: value, shellArguments: flavour?.defaultShellArguments ?? '' });
  };
  const runAsAdmin = values.runAsAdmin === 'true';
  // Absent means ON, like the directory beside it — only an explicit 'false' turns it off.
  const rememberCommand = values.rememberCommand !== 'false';
  // Absent means ON (FR-027a) — only an explicit 'false' turns it off.
  const rememberDirectory = values.rememberDirectory !== 'false';
  // Some shells (PowerShell) cannot be observed from outside and only report their directory while
  // shell integration is on. Offering the control anyway would be a lie: it would look enabled and
  // do nothing. Disabled with a reason instead — the same treatment "Run as administrator" gets
  // when throng is not elevated.
  const canReportDirectory =
    flavours.find((f) => f.value === values.flavourId)?.reportsDirectory !== false;

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
      {/* 025 FR-002: renamed from "Startup Params". The two fields below configure genuinely
          different things — arguments handed TO the shell, versus a command the shell RUNS — and
          sharing the word "Startup" is what made them confusable. */}
      <label className="panel-type-form__field">
        <span>Shell Arguments</span>
        <input
          type="text"
          data-testid="terminal-shell-arguments"
          title="Arguments passed to the shell itself, e.g. -NoLogo"
          value={values.shellArguments ?? ''}
          onChange={(e) => onChange({ ...values, shellArguments: e.target.value })}
        />
      </label>
      <label className="panel-type-form__field">
        <span>Startup Command</span>
        <input
          type="text"
          data-testid="terminal-startup-command"
          placeholder="e.g. npm run dev"
          title="A command the shell runs when this terminal starts. The shell stays open afterwards."
          value={values.startupCommand ?? ''}
          onChange={(e) => onChange({ ...values, startupCommand: e.target.value })}
        />
      </label>
      <label
        className="panel-type-form__check"
        title="When the terminal ends with a command still running, save that command as this panel's Startup Command"
      >
        <input
          type="checkbox"
          data-testid="terminal-remember-command"
          checked={rememberCommand}
          onChange={(e) =>
            onChange({ ...values, rememberCommand: e.target.checked ? 'true' : 'false' })
          }
        />
        <span>Remember the last running command</span>
      </label>
      <label
        className="panel-type-form__check"
        title={
          canReportDirectory
            ? 'Reopen this terminal in the directory it was last working in, instead of the project root'
            : 'This shell only reports its working directory when Shell integration is on — enable it in Settings › Terminal'
        }
      >
        <input
          type="checkbox"
          data-testid="terminal-remember-directory"
          checked={rememberDirectory && canReportDirectory}
          disabled={!canReportDirectory}
          onChange={(e) =>
            onChange({ ...values, rememberDirectory: e.target.checked ? 'true' : 'false' })
          }
        />
        <span>Reopen in the last directory</span>
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
