import { useSyncExternalStore } from 'react';
import { getTerminalTitle, getTerminalTitleSetAt } from './title-store.js';

/**
 * Live foreground commands per terminal panel (025 FR-019), the twin of `cwd-store.ts`.
 *
 * The daemon observes which command holds each terminal and pushes `terminal.command`
 * notifications; UI-main forwards them here. Command memory reads the value at the moment a
 * terminal ends and decides whether to promote it into the Panel's memory.
 *
 * Module-level, so the single bridge subscription is shared across every panel rather than one
 * per panel — the same reason `cwd-store` is built this way.
 *
 * The value is deliberately RETAINED when a terminal detaches or the daemon stops observing
 * (FR-019f): the last thing seen running is the capture candidate, and clearing it on detach
 * would silently turn "still running" into "nothing was running" and lose the user's command.
 */
const commands = new Map<string, string | null>();
/**
 * The architecture of the process holding each terminal (053 FR-003 `{arch}`), kept beside its command
 * because the daemon sends the two in one notification and one does not outlive the other.
 */
const archs = new Map<string, string>();
/**
 * 053 FR-003 `{title}` — the window title each panel's shell showed at its last prompt (the last
 * observation of nothing running). A shell's title is not a program's; see {@link peekProgramTitle}.
 */
const promptTitles = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * Bumped on every change, so a surface naming MANY panels subscribes once — the same shape as
 * `title-store.ts`'s version (#294).
 */
let version = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}
let unsubscribeBridge: (() => void) | null = null;

/**
 * Register the bridge listener.
 *
 * MUST be called when a terminal MOUNTS, not when its value is first read. Subscribing lazily on
 * read meant the listener was installed at the first terminal *end* — by which point every
 * notification for that session had already been dropped, so the first capture of every renderer
 * session saw nothing and silently saved nothing. `cwd-store` escapes this only because a panel
 * header subscribes to it on mount; this store has no such reader, so it must be armed explicitly.
 */
export function ensureTerminalCommandBridge(): void {
  ensureBridge();
}

function ensureBridge(): void {
  if (unsubscribeBridge) return;
  unsubscribeBridge =
    // `arch` is absent while the OS gave none, and from a command that has gone.
    window.throng?.terminal?.onCommand?.((e) => record(e.panelId, e.command, e.arch ?? undefined, e.observedAt)) ?? null;
}

/**
 * `observedAt` is when the daemon began the reading behind this observation (epoch ms; absent from a view's attach
 * reply). A title that arrived AFTER it cannot be the prompt's: the program that set it started after the reading,
 * which is why the reading saw nothing running. The program's output and the daemon's observations travel on separate
 * channels, so that stale "nothing running" can arrive after the program's title — and, snapshotted as the prompt's,
 * the program's own title was never shown (053 FR-003; a program titling itself once as it starts lost it 1 run in 9).
 * Such a title leaves the previous snapshot in place.
 */
function record(panelId: string, command: string | null, arch: string | undefined, observedAt?: number): void {
  if (commands.get(panelId) === command && archs.get(panelId) === arch) return;
  if (command === null) {
    const atPrompt = getTerminalTitle(panelId);
    const arrivedAfterReading = observedAt !== undefined && (getTerminalTitleSetAt(panelId) ?? 0) > observedAt;
    if (atPrompt === undefined) promptTitles.delete(panelId);
    else if (!arrivedAfterReading) promptTitles.set(panelId, atPrompt);
  }
  commands.set(panelId, command);
  if (arch === undefined) archs.delete(panelId);
  else archs.set(panelId, arch);
  emit();
}

/**
 * 053 — record what the daemon said holds a panel's terminal when a view (re-)attached: the same value
 * the `terminal.command` notification carried, which a mounting view dropped and the daemon will not
 * send again while it is unchanged.
 */
export function reportTerminalCommand(panelId: string, command: string | null, arch?: string | null): void {
  record(panelId, command, arch ?? undefined);
}

/**
 * Subscribe to this panel's observed command, so it can be persisted as it changes (FR-019).
 * Returns `undefined` until the first observation arrives.
 */
export function useTerminalCommand(panelId: string): string | null | undefined {
  return useSyncExternalStore(
    (notify) => {
      ensureBridge();
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => commands.get(panelId),
    () => undefined,
  );
}

/**
 * The command last observed holding `panelId`'s terminal, or null when it was last seen idle.
 * `undefined` means nothing has been observed yet — which is NOT the same as idle, and callers
 * must not treat it as "nothing was running".
 */
export function peekTerminalCommand(panelId: string): string | null | undefined {
  ensureBridge();
  return commands.get(panelId);
}

/**
 * Drop a panel's observation.
 *
 * Called when a terminal COLD-STARTS, so a value observed in that panel's previous terminal can
 * never be promoted into the next one. Without this, a panel whose second terminal runs a command
 * that exits immediately re-saves the first terminal's command — which FR-017 forbids ("MUST NOT
 * be replaced by a command that has already exited").
 */
export function forgetTerminalCommand(panelId: string): void {
  // A name already showing the old command re-renders to the new terminal's: FR-016.
  const had = commands.delete(panelId);
  if (archs.delete(panelId) || had) emit();
}

/**
 * Titles a shell sets for itself (053 FR-003): Git Bash's prompt (`MINGW64:/d/git/throng`, and the
 * other MSYS2 environments), and a program's own path — how cmd, PowerShell and Windows PowerShell
 * title their window, cmd with ` - <command>` while one runs, either with `Administrator: ` first.
 */
const SHELL_TITLE = /^(?:(?:MINGW(?:32|64)|MSYS|UCRT64|CLANG(?:32|64|ARM64)):|(?:Administrator: )?[A-Za-z]:\\[^"]*?\.(?:exe|com)(?: - |$))/i;

/**
 * The window title the running program set (053 `{title}`): `undefined` while nothing runs, and for
 * a title the shell set — one of {@link SHELL_TITLE}'s forms, or the title its last prompt showed
 * (cmd's `<that> - <command>` included).
 *
 * By form rather than by when it arrived: a program restored with its terminal, or one whose view
 * remounts on a project switch, titled itself before the daemon's next observation, and is still its
 * own title.
 */
export function peekProgramTitle(panelId: string): string | undefined {
  if (!commands.get(panelId)) return undefined;
  const title = getTerminalTitle(panelId);
  if (title === undefined || SHELL_TITLE.test(title)) return undefined;
  const atPrompt = promptTitles.get(panelId);
  if (atPrompt !== undefined && (title === atPrompt || title.startsWith(`${atPrompt} - `))) return undefined;
  return title;
}

/**
 * The architecture last observed for `panelId`'s command (053 `{arch}`), read without subscribing.
 * `undefined` until one is reported, and again once the command goes — the OS gave none.
 */
export function peekTerminalArch(panelId: string): string | undefined {
  return archs.get(panelId);
}

/** Re-render when ANY panel's command or architecture changes; read them with the `peek` functions. */
export function useTerminalCommandVersion(): number {
  return useSyncExternalStore(
    (notify) => {
      ensureBridge();
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => version,
    () => version,
  );
}

/**
 * Test seam: what the DAEMON says is running in a panel, exposed like the terminal diagnostics.
 *
 * An E2E asking "did claude exit?" needs an answer claude cannot spoof. Reading the screen fails
 * (claude leaves its transcript behind); reading the panel header fails too, because that shows the
 * window title claude sets for itself — one run reported "10 awaiting input - claude agents" and
 * looked exactly like a live session. This value comes from the daemon polling the session's child
 * processes, so it reflects the process table and nothing else.
 */
declare global {
  interface Window {
    __throngTerminalCommand?: (panelId: string) => string | null | undefined;
  }
}

if (typeof window !== 'undefined') {
  window.__throngTerminalCommand = (panelId: string) => peekTerminalCommand(panelId);
}
