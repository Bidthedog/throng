// JSON-RPC shapes for the `projects.*` methods (002 / contracts/ipc-projects.md).
// All methods are scoped to the current owner_user, resolved by the daemon via
// IUserContext — the client never sends it. Transport is the same
// newline-delimited JSON-RPC 2.0 named pipe as health.ping.

/** JSON-RPC error code for invalid parameters (standard). */
export const JSON_RPC_INVALID_PARAMS = -32602;
/** JSON-RPC error code for a referenced entity that does not exist (custom). */
export const JSON_RPC_NOT_FOUND = -32004;

export const PROJECTS_LIST_METHOD = 'projects.list';
export const PROJECTS_CREATE_METHOD = 'projects.create';
export const PROJECTS_UPDATE_METHOD = 'projects.update';
export const PROJECTS_DELETE_METHOD = 'projects.delete';
export const PROJECTS_SET_ACTIVE_METHOD = 'projects.setActive';
export const PROJECTS_REORDER_METHOD = 'projects.reorder';
export const PROJECTS_SET_HIDDEN_METHOD = 'projects.setHidden';

/** Wire representation of a project (mirrors the core Project, owner key elided). */
export interface ProjectDto {
  id: string;
  name: string;
  colour: string;
  rootFolder: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Root-relative paths hidden from the file tree, on top of excludeGlobs (004). */
  hiddenPaths: string[];
  /** Tabs in the project's saved layout (from `projects.list`; omitted elsewhere). */
  tabCount?: number;
  /** Panels across the project's saved layout (from `projects.list`; omitted elsewhere). */
  panelCount?: number;
}

export type ProjectsListParams = Record<string, never>;
export interface ProjectsListResult {
  projects: ProjectDto[];
}

export interface ProjectsCreateParams {
  name: string;
  colour: string;
  rootFolder: string;
}
export interface ProjectsCreateResult {
  project: ProjectDto;
}

export interface ProjectsUpdateParams {
  id: string;
  name?: string;
  colour?: string;
  rootFolder?: string;
}
export interface ProjectsUpdateResult {
  project: ProjectDto;
}

export interface ProjectsDeleteParams {
  id: string;
}
export interface ProjectsDeleteResult {
  deletedId: string;
  newActiveId: string | null;
}

export interface ProjectsSetActiveParams {
  id: string;
}
export interface ProjectsSetActiveResult {
  activeId: string;
}

export interface ProjectsReorderParams {
  orderedIds: string[];
}
export interface ProjectsReorderResult {
  orderedIds: string[];
}

export interface ProjectsSetHiddenParams {
  id: string;
  hiddenPaths: string[];
}
export interface ProjectsSetHiddenResult {
  project: ProjectDto;
}
