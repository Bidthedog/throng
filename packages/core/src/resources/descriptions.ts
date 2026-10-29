import type { ComponentId, ResourceNode, ThrongRole } from './types.js';

/**
 * Why each component and each of throng's own processes exists (055 FR-102), shown as the row's hover
 * title and in the help panel. One or two sentences each, and never a figure: a title changes under a
 * resting pointer if it does (FR-095).
 */
export const COMPONENT_DESCRIPTIONS: Readonly<Record<ComponentId, string>> = Object.freeze({
  ui: "throng's windows: the application process that runs them, each window's renderer, and the GPU and utility processes Electron starts to draw them.",
  daemon:
    'The background process that keeps your terminals running when throng\'s windows close, and keeps your projects, layouts and documents.',
  helpers:
    'Small processes throng starts to serve your terminals and folders: console hosts, folder locks, this monitor\'s collector and, when throng runs as administrator, the de-elevation agent.',
  projects: 'Your work: each project, its tabs and panels, and every process your terminals started.',
});

export const ROLE_DESCRIPTIONS: Readonly<Record<ThrongRole, string>> = Object.freeze({
  main: "throng's application process. It owns the windows, the menus and settings, and talks to the daemon for them.",
  window: 'The renderer that draws one throng window, with its panels, editors and previews.',
  gpu: 'Electron\'s GPU process, which draws every throng window on the graphics card.',
  utility: 'A helper process Electron starts for one job, such as network requests or audio.',
  daemon: 'The background process that keeps your terminals running when throng\'s windows close.',
  conhost:
    "Windows' console host for one terminal. It turns the shell's console output into the text the terminal panel shows.",
  'lock-helper':
    'Holds a project folder open, so it cannot be moved or deleted from under throng while you work in it.',
  collector: "This monitor's own process. It measures throng's usage, so the measuring never slows throng's windows.",
  'deelevation-agent':
    'Runs your terminals as a normal user while throng itself runs as administrator, so shells do not inherit its rights.',
});

/** The hover title for a row, or `undefined` for the user's own processes, projects, tabs and panels. */
export function describeNode(node: ResourceNode): string | undefined {
  if (node.kind === 'component') return COMPONENT_DESCRIPTIONS[node.owner.component];
  if (node.role !== undefined) return ROLE_DESCRIPTIONS[node.role];
  return undefined;
}
