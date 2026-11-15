/**
 * Install and Uninstall 'throng' command (070 FR-024a, research R20, contracts/app-lifecycle-macos.md): main's half.
 *
 * The seam (`platform`'s `commandLineInstall`) does the work, the system's own administrator prompt included. This
 * asks before replacing another program's `throng`, runs one action at a time, and turns each into exactly one
 * outcome for the main window to show (one condition, one notice). At start, a command that no longer reaches this
 * copy of throng — the app was moved — is reported once, with an Install action on the notice.
 */
import type { IpcMain } from 'electron';
import { logCaught, logExpected, type CommandLineStatus, type ICommandLineInstall } from '@throng/core';

/** What one action came to, for the main window's notice. */
export type CommandLineOutcome =
  | { readonly kind: 'installed'; readonly linkPath: string }
  | { readonly kind: 'uninstalled'; readonly linkPath: string }
  | { readonly kind: 'failed'; readonly action: 'install' | 'uninstall'; readonly reason: string }
  /** At start: the installed command points at a throng that has moved or gone. */
  | { readonly kind: 'broken'; readonly linkPath: string; readonly target: string };

export const COMMAND_LINE_OUTCOME_CHANNEL = 'throng:commandLine:outcome';
export const COMMAND_LINE_INSTALL_CHANNEL = 'throng:commandLine:install';
export const COMMAND_LINE_UNINSTALL_CHANNEL = 'throng:commandLine:uninstall';
export const COMMAND_LINE_READY_CHANNEL = 'throng:commandLine:ready';

/** Where the command is, by default — the one place `/usr/local/bin` is named on this side. */
const DEFAULT_LINK = '/usr/local/bin/throng';

export interface CommandLineInstallController {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  checkAtStart(): Promise<void>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : String(error);
}

function linkOf(status: CommandLineStatus): string {
  return status.kind === 'absent' ? DEFAULT_LINK : status.linkPath;
}

export function createCommandLineInstallController(deps: {
  readonly seam: ICommandLineInstall;
  /** Ask the user whether to replace another program's `throng`; true to replace. */
  readonly confirmReplace: (other: { linkPath: string; target: string }) => Promise<boolean>;
  readonly report: (outcome: CommandLineOutcome) => void;
}): CommandLineInstallController {
  const { seam, confirmReplace, report } = deps;
  // One action at a time: a second click while the system prompt is up would stack a second prompt.
  let busy = false;
  const exclusive = async (run: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  };

  return {
    install: () =>
      exclusive(async () => {
        try {
          const before = await seam.status();
          let replaceOther = false;
          if (before.kind === 'other') {
            if (!(await confirmReplace({ linkPath: before.linkPath, target: before.target }))) return;
            replaceOther = true;
          }
          const after = await seam.install({ replaceOther });
          if (after.kind === 'ours') report({ kind: 'installed', linkPath: after.linkPath });
          else report({ kind: 'failed', action: 'install', reason: `${linkOf(after)} still does not open throng.` });
        } catch (error) {
          // Shown to the user as the failure notice, and recorded so it outlives the notice (066, Principle XIII).
          logCaught('command-line-install: install the throng command', error);
          report({ kind: 'failed', action: 'install', reason: reasonOf(error) });
        }
      }),
    uninstall: () =>
      exclusive(async () => {
        try {
          const before = await seam.status();
          const after = await seam.uninstall();
          if (after.kind === 'absent') report({ kind: 'uninstalled', linkPath: linkOf(before) });
          else if (after.kind === 'other')
            report({
              kind: 'failed',
              action: 'uninstall',
              reason: `${after.linkPath} points at ${after.target}, not throng, so it was left alone.`,
            });
          else report({ kind: 'failed', action: 'uninstall', reason: `${after.linkPath} is still in place.` });
        } catch (error) {
          logCaught('command-line-install: uninstall the throng command', error);
          report({ kind: 'failed', action: 'uninstall', reason: reasonOf(error) });
        }
      }),
    checkAtStart: async () => {
      if (!seam.available) return;
      try {
        const status = await seam.status();
        if (status.kind === 'ours-broken') report({ kind: 'broken', linkPath: status.linkPath, target: status.target });
      } catch (error) {
        // A status that cannot be read says nothing about the command; the user sees nothing rather than a guess.
        logExpected(
          'command-line-install: check the throng command at start',
          'an unreadable status says nothing about the command, so no notice is raised',
          error,
        );
      }
    },
  };
}

/** The main window's end of the channel: what it needs of a `WebContents`. */
export interface OutcomeListener {
  send(channel: string, outcome: CommandLineOutcome): void;
  isDestroyed(): boolean;
}

/**
 * Holds outcomes until the main window says it is listening (the start-up one can be ready before the window is),
 * then delivers them in order, and every later one at once.
 */
export function createOutcomeRelay(): { report(outcome: CommandLineOutcome): void; attach(listener: OutcomeListener): void } {
  const pending: CommandLineOutcome[] = [];
  let listener: OutcomeListener | undefined;
  const deliver = (outcome: CommandLineOutcome): boolean => {
    if (!listener || listener.isDestroyed()) return false;
    listener.send(COMMAND_LINE_OUTCOME_CHANNEL, outcome);
    return true;
  };
  return {
    report(outcome) {
      if (!deliver(outcome)) pending.push(outcome);
    },
    attach(next) {
      listener = next;
      while (pending.length > 0 && deliver(pending[0] as CommandLineOutcome)) pending.shift();
    },
  };
}

/** The renderer's routes to the two actions (the key bindings list, Principle VI), and its ready signal. */
export function registerCommandLineIpc(
  ipcMain: Pick<IpcMain, 'on'>,
  controller: CommandLineInstallController,
  relay: { attach(listener: OutcomeListener): void },
): void {
  ipcMain.on(COMMAND_LINE_INSTALL_CHANNEL, () => void controller.install());
  ipcMain.on(COMMAND_LINE_UNINSTALL_CHANNEL, () => void controller.uninstall());
  ipcMain.on(COMMAND_LINE_READY_CHANNEL, (event) => relay.attach(event.sender));
}
