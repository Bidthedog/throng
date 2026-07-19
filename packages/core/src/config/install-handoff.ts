/**
 * Live-terminal handoff for upgrade/uninstall (020 FR-019).
 *
 * When an upgrade or uninstall runs while terminals still have LIVE processes, the operation must
 * not silently kill or strand them. It routes to the app's EXISTING three-choice prompt (the same
 * "leave running / terminate all / cancel" the app already shows on close), and each choice leaves
 * no orphaned terminal process (Principle III): "leave" keeps them owned by the surviving daemon,
 * "terminate" ends the whole terminal→host→helper tree cleanly, "cancel" changes nothing.
 *
 * These are the PURE decisions. The installer↔app wiring (`packaging/installer.nsh` requests the
 * running app to close; the app's close handler shows the prompt and reports the choice back) is
 * what executes them — reusing the app's dialog rather than reinventing it.
 */

export type LiveTerminalChoice = 'leave' | 'terminate' | 'cancel';

export interface LiveTerminalHandoffInput {
  /** The running app reports whether any terminal currently has a live child process. */
  hasLiveTerminals: boolean;
}

export interface LiveTerminalHandoffDecision {
  /** The three-choice prompt must be shown before the operation proceeds. */
  prompt: boolean;
  /** The operation may proceed immediately (no live terminals to warn about). */
  proceed: boolean;
}

/**
 * Decide whether an upgrade/uninstall must pause for the live-terminal prompt. With live terminals
 * it prompts and does NOT proceed; with none it proceeds directly.
 */
export function decideLiveTerminalHandoff(input: LiveTerminalHandoffInput): LiveTerminalHandoffDecision {
  return input.hasLiveTerminals ? { prompt: true, proceed: false } : { prompt: false, proceed: true };
}

export interface LiveTerminalChoiceOutcome {
  /** The upgrade/uninstall proceeds after this choice. */
  proceed: boolean;
  /** Every terminal (and its host/helper) must be terminated with no orphan left behind. */
  terminateTerminals: boolean;
}

/**
 * Resolve one of the three choices into what the installer/app must do. No outcome orphans a
 * process: "leave" proceeds with the terminals still owned by the (surviving) daemon, "terminate"
 * proceeds after ending the whole tree, "cancel" aborts and touches nothing.
 */
export function resolveLiveTerminalChoice(choice: LiveTerminalChoice): LiveTerminalChoiceOutcome {
  switch (choice) {
    case 'leave':
      return { proceed: true, terminateTerminals: false };
    case 'terminate':
      return { proceed: true, terminateTerminals: true };
    case 'cancel':
      return { proceed: false, terminateTerminals: false };
  }
}
