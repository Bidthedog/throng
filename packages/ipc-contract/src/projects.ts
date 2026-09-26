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
// Project categories (046, contracts/project-categories.md §1). Every refusal, an unknown id
// included, is JSON_RPC_INVALID_PARAMS.
export const PROJECTS_CATEGORIES_LIST_METHOD = 'projects.categories.list';
export const PROJECTS_CATEGORIES_CREATE_METHOD = 'projects.categories.create';
export const PROJECTS_CATEGORIES_RENAME_METHOD = 'projects.categories.rename';
export const PROJECTS_CATEGORIES_DELETE_METHOD = 'projects.categories.delete';
export const PROJECTS_CATEGORIES_SET_MINIMISED_METHOD = 'projects.categories.setMinimised';
/** 046 iterate round 1 (FR-083, contracts/project-categories.md §5). */
export const PROJECTS_CATEGORIES_REORDER_METHOD = 'projects.categories.reorder';
export const PROJECTS_MOVE_METHOD = 'projects.move';

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
  /**
   * The category the project is listed under (046 FR-059). Always resolved by the daemon: `''` or an
   * id naming no category reads back as the owner's default category, so this is never `''`.
   */
  categoryId: string;
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

/** Wire representation of a project category (046; mirrors the core ProjectCategory, owner elided). */
export interface ProjectCategoryDto {
  id: string;
  name: string;
  /** Exactly one per owner; it cannot be deleted or minimised. */
  isDefault: boolean;
  minimised: boolean;
  /**
   * Orders the non-default categories (FR-083 / FR-084). The default is listed first whatever its
   * value; a new category is appended one past the owner's highest.
   */
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectsCategoriesListParams = Record<string, never>;
export interface ProjectsCategoriesListResult {
  /** The default category first, then the rest by `position`, then `id` (FR-083 / FR-084). */
  categories: ProjectCategoryDto[];
}

export interface ProjectsCategoriesReorderParams {
  /** Every NON-default category's id, exactly once, in the new order (FR-083). */
  orderedIds: string[];
}
export interface ProjectsCategoriesReorderResult {
  /** The owner's categories in their new list order, the default first. */
  categories: ProjectCategoryDto[];
}

export interface ProjectsCategoriesCreateParams {
  name: string;
}
export interface ProjectsCategoriesCreateResult {
  category: ProjectCategoryDto;
}

export interface ProjectsCategoriesRenameParams {
  id: string;
  name: string;
}
export interface ProjectsCategoriesRenameResult {
  category: ProjectCategoryDto;
}

export interface ProjectsCategoriesDeleteParams {
  id: string;
}
export interface ProjectsCategoriesDeleteResult {
  /** The projects moved into the default category (FR-054). */
  movedProjectIds: string[];
}

export interface ProjectsCategoriesSetMinimisedParams {
  id: string;
  minimised: boolean;
}
export interface ProjectsCategoriesSetMinimisedResult {
  category: ProjectCategoryDto;
}

export interface ProjectsMoveParams {
  id: string;
  categoryId: string;
  /** The owner's whole global project order after the move (FR-055). */
  orderedIds: string[];
}
export interface ProjectsMoveResult {
  orderedIds: string[];
}
