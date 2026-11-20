/**
 * 073 FR-038 — the four bindable insert commands, routed to the CSV Preview Editor that has focus.
 *
 * Neutral ground — beside the grid, not in a provider folder — because the window's key handler, a surface,
 * may name no provider module. A mounted CSV body registers what each command does to ITS active cell; the window's key handler
 * (`preview-commands.tsx`) resolves the chord and calls the focused panel's entry. Non-reactive, like
 * `editor-actions.ts`.
 */

export interface CsvGridCommands {
  insertRowAbove(): void;
  insertRowBelow(): void;
  insertColumnLeft(): void;
  insertColumnRight(): void;
}

export type CsvGridCommandId = 'grid.insertRowAbove' | 'grid.insertRowBelow' | 'grid.insertColumnLeft' | 'grid.insertColumnRight';

const GRID_COMMANDS: ReadonlySet<string> = new Set<CsvGridCommandId>([
  'grid.insertRowAbove',
  'grid.insertRowBelow',
  'grid.insertColumnLeft',
  'grid.insertColumnRight',
]);

/** Whether a resolved action is one of the grid's commands. */
export function isGridCommand(action: string | null | undefined): action is CsvGridCommandId {
  return typeof action === 'string' && GRID_COMMANDS.has(action);
}

const registry = new Map<string, CsvGridCommands>();

export function registerCsvGridCommands(panelId: string, commands: CsvGridCommands): void {
  registry.set(panelId, commands);
}

export function unregisterCsvGridCommands(panelId: string): void {
  registry.delete(panelId);
}

/** Run `id` on `panelId`'s grid. False when that panel is no mounted CSV Preview Editor. */
export function runCsvGridCommand(panelId: string, id: CsvGridCommandId): boolean {
  const commands = registry.get(panelId);
  if (commands === undefined) return false;
  switch (id) {
    case 'grid.insertRowAbove':
      commands.insertRowAbove();
      break;
    case 'grid.insertRowBelow':
      commands.insertRowBelow();
      break;
    case 'grid.insertColumnLeft':
      commands.insertColumnLeft();
      break;
    case 'grid.insertColumnRight':
      commands.insertColumnRight();
      break;
  }
  return true;
}
