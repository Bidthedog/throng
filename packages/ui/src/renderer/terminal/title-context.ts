/**
 * What a terminal panel's NAME is rendered from besides the per-panel stores (053).
 *
 * `panelDisplayTitle` renders a terminal's name from a template, a pair of shortening limits and the
 * live values (`TerminalTitleValues`). The values are per panel and live in their own stores —
 * command (with its architecture), working directory and window title. Everything else is the same
 * for every panel in a window: the template and limits (settings), whether throng is elevated, and
 * the names `{project}` can resolve to. That is this module's store.
 *
 * ══ WHY A MODULE STORE AND NOT A CONTEXT ══
 *
 * `panelTitleSources` is a plain function, not a hook — the failure notices, the menus and the
 * file-tree's "which panel" label name a panel at a MOMENT, from a timer or an IPC answer, with no
 * component to read a context from (048 FR-032). So the window-wide inputs sit where those callers
 * can reach them, and {@link TerminalTitleContextFeeder} keeps them current from the providers.
 * `use-panel-display-names.ts` subscribes to {@link useTerminalTitleContextVersion} so a surface
 * naming panels re-renders when a setting changes: no terminal remounts (FR-013).
 *
 * ══ EVERY WINDOW FOLLOWS (research R2, Principle XI) ══
 *
 * Each renderer mounts its own feeder under its own `ConfigProvider`, and the config broadcast
 * reaches every window, so a sub-workspace showing the terminal renders the same name.
 *
 * ══ UNFED MEANS "AS BEFORE 053" ══
 *
 * Until a feeder has run, {@link terminalTitleSource} returns `undefined` and a terminal is named by
 * its window title or its shell, as it was. That is the state of a caller outside the app's
 * providers, and of the first frame before the feeder's layout effect.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react';
import type { Panel, PanelTitleSources, TerminalTitleValues } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { useCapabilities } from '../panel-type/use-capabilities.js';
import { useProjectsOptional } from '../state/projects-store.js';
import { useSubWorkspaceWindow } from '../workspace/subworkspace-window-context.js';
import { peekProgramTitle, peekTerminalArch, peekTerminalCommand } from './command-store.js';
import { peekTerminalCwd } from './cwd-store.js';

/** The window-wide inputs to a terminal's name. */
export interface TerminalTitleContext {
  /** `terminals.titleTemplate`, as text — core memoises its parse and falls back when it is invalid. */
  template: string;
  /** `terminals.titleCommandMaxLength` and `terminals.titlePathMaxLength` (FR-012). */
  limits: { command: number; path: number };
  /** Registered projects' names by id, for `{project}`. */
  projects: ReadonlyMap<string, string>;
  /** The sub-workspace this window shows, else null: `{project}` for a panel with no registered project. */
  subWorkspaceName: string | null;
  /** Whether throng runs elevated; `{admin}` also needs the panel to have asked for it. */
  elevated: boolean;
}

let current: TerminalTitleContext | null = null;
let version = 0;
const listeners = new Set<() => void>();

function sameContext(a: TerminalTitleContext | null, b: TerminalTitleContext | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.template !== b.template) return false;
  if (a.limits.command !== b.limits.command || a.limits.path !== b.limits.path) return false;
  if (a.subWorkspaceName !== b.subWorkspaceName || a.elevated !== b.elevated) return false;
  if (a.projects.size !== b.projects.size) return false;
  for (const [id, name] of a.projects) if (b.projects.get(id) !== name) return false;
  return true;
}

/** Replace the window-wide inputs; `null` returns terminals to their pre-053 naming. */
export function setTerminalTitleContext(next: TerminalTitleContext | null): void {
  if (sameContext(current, next)) return;
  current = next;
  version += 1;
  for (const l of listeners) l();
}

/** Re-render when the template, a limit, the elevation or a project name changes. */
export function useTerminalTitleContextVersion(): number {
  return useSyncExternalStore(
    (notify) => {
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
 * The raw values a terminal panel's name is rendered from, gathered from the stores right now
 * (FR-001). Raw on purpose: core derives `{command}`, `{app}`, `{path}` and `{folder}` from them so
 * every surface shortens them the same way.
 */
export function terminalTitleValues(panel: Panel, ctx: TerminalTitleContext): TerminalTitleValues {
  const shell =
    [panel.config?.flavourLabel, panel.config?.flavourId].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    ) ?? '';
  return {
    command: peekTerminalCommand(panel.id),
    arch: peekTerminalArch(panel.id),
    // 053 FR-003 — the running program's own title, never one the shell set before it started.
    title: peekProgramTitle(panel.id),
    shell,
    cwd: peekTerminalCwd(panel.id),
    // By the panel's origin project; a panel with none registered belongs to the sub-workspace, which
    // is how the header's owner label resolves it (`panel-placeholder.tsx`).
    project: ctx.projects.get(panel.originProjectId) ?? ctx.subWorkspaceName,
    admin: panel.config?.runAsAdmin === true && ctx.elevated,
  };
}

/**
 * The `terminal` source for `panelDisplayTitle`, or `undefined` when `panel` is not a terminal or
 * nothing has fed the context yet — in which case the panel is named as it was before 053.
 */
export function terminalTitleSource(panel: Panel): PanelTitleSources['terminal'] {
  if (panel.kind !== 'terminal' || current === null) return undefined;
  return {
    values: terminalTitleValues(panel, current),
    template: current.template,
    limits: current.limits,
  };
}

/**
 * Keep the module store current from this window's providers (053 T022a). Mount once per window,
 * inside `ConfigProvider`, `ProjectsProvider` and — in a sub-workspace window — the sub-workspace
 * identity provider. Renders nothing.
 *
 * A LAYOUT effect, so the first named frame already has the template: a passive effect would paint
 * every terminal's pre-053 name once and then swap it.
 */
export function TerminalTitleContextFeeder(): null {
  const { terminals } = useAppSettings();
  const projects = useProjectsOptional()?.projects;
  const subWorkspace = useSubWorkspaceWindow();
  const { elevated } = useCapabilities();
  const subWorkspaceName = subWorkspace?.name ?? null;

  useLayoutEffect(() => {
    setTerminalTitleContext({
      template: terminals.titleTemplate,
      limits: { command: terminals.titleCommandMaxLength, path: terminals.titlePathMaxLength },
      projects: new Map((projects ?? []).map((p) => [p.id, p.name])),
      subWorkspaceName,
      elevated,
    });
  }, [
    terminals.titleTemplate,
    terminals.titleCommandMaxLength,
    terminals.titlePathMaxLength,
    projects,
    subWorkspaceName,
    elevated,
  ]);

  return null;
}
