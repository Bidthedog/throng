export { openDatabase } from './database.js';
export type { ThrongDatabase } from './database.js';
export { runMigrations, BASELINE_VERSION, LATEST_VERSION } from './migration-runner.js';
export type { MigrationResult } from './migration-runner.js';
export { reconcileSchema, addColumnsFor } from './schema-guard.js';
export type { ColumnRepair } from './schema-guard.js';
export { ProjectRepository } from './project-repository.js';
export { WorkspaceRepository } from './workspace-repository.js';
export { SubWorkspaceRepository } from './subworkspace-repository.js';
// Per-document state (016) — the language override, keyed by the FILE rather than the panel.
export { DocumentStateRepository } from './document-state-repository.js';
export { FileOpUndoRepository } from './fileop-undo-repository.js';
export type { DocumentState } from './document-state-repository.js';
