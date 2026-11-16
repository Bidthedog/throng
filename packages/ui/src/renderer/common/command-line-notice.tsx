/**
 * The `throng` command's notices (070 FR-024a), mounted once in the main window by `app.tsx`.
 *
 * Main runs Install and Uninstall 'throng' command (from the app menu or a key binding) and pushes the one outcome
 * each comes to. One notice per outcome: success says where the command now is, a declined approval or a failure says
 * what went wrong, and a command that no longer reaches throng (the app was moved) says so once at start, with Install
 * on the notice because that is what resolves it (one condition, one notice; the action lives on it).
 */
import { useEffect, type ReactElement } from 'react';
import type { NoticeSeverity, NoticeSubject } from '@throng/core';
import type { CommandLineOutcome } from '../global.js';
import { IconButton } from './icon-button.js';
import { useNotify } from './notification.js';

const TEST_ID = 'command-line-notice';

/** The command file, named the way every notice names a file. */
function subjectOf(linkPath: string): NoticeSubject {
  const slash = linkPath.lastIndexOf('/');
  return slash > 0
    ? { kind: 'file', name: linkPath.slice(slash + 1), dir: linkPath.slice(0, slash) }
    : { kind: 'file', name: linkPath };
}

const COMMAND_SUBJECT: NoticeSubject = { kind: 'file', name: 'throng' };

/** What a notice for `outcome` says, and how serious it is. Exported for the component test. */
export function commandLineNoticeFor(outcome: CommandLineOutcome): {
  severity: NoticeSeverity;
  message: string;
  subject: NoticeSubject;
} {
  switch (outcome.kind) {
    case 'installed':
      return {
        severity: 'success',
        message: `The throng command is installed at ${outcome.linkPath}. Open a new terminal to use it.`,
        subject: subjectOf(outcome.linkPath),
      };
    case 'uninstalled':
      return {
        severity: 'success',
        message: `The throng command is no longer on your PATH.`,
        subject: subjectOf(outcome.linkPath),
      };
    case 'failed':
      return {
        severity: 'error',
        message: `${outcome.action === 'install' ? 'Couldn’t install' : 'Couldn’t uninstall'} the throng command: ${outcome.reason}`,
        subject: COMMAND_SUBJECT,
      };
    case 'broken':
      return {
        severity: 'warning',
        message: `The throng command at ${outcome.linkPath} no longer opens throng, because the app has moved. Install it again to point it here.`,
        subject: subjectOf(outcome.linkPath),
      };
  }
}

export function CommandLineNotice(): null {
  const { notify } = useNotify();

  useEffect(() => {
    const commandLine = window.throng?.commandLine;
    if (!commandLine) return undefined;
    const off = commandLine.onOutcome((outcome) => {
      const { severity, message, subject } = commandLineNoticeFor(outcome);
      const install: ReactElement | undefined =
        outcome.kind === 'broken' ? (
          <IconButton
            token="retry"
            className="notice__control"
            testId="command-line-install"
            title="Install 'throng' command"
            onClick={() => commandLine.install()}
          />
        ) : undefined;
      notify({
        severity,
        subject,
        message,
        testId: TEST_ID,
        // The card's own control, beside Copy and Dismiss (constitution 6.8.0, toast controls; 069 FR-050).
        ...(install ? { controls: install, sticky: true } : {}),
      });
    });
    commandLine.ready();
    return off;
  }, [notify]);

  return null;
}
