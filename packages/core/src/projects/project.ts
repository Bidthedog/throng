/**
 * Project domain entity (Constitution Principle I). A project is the root
 * context of the application: it owns a Workspace and a Terminals list. This
 * iteration carries name, dominant colour, and root-folder path (FR-003); the
 * file explorer / Markdown preview / edit list remain out of scope.
 *
 * Pure types + validation only — no OS/process calls (Principle II). Identity
 * (`id`) and timestamps are supplied by the caller (the daemon composition root
 * injects a UUID generator and clock), keeping this module side-effect free.
 *
 * Validation and the `createProject` factory live alongside the type (added in
 * the US1 implementation tasks).
 */
export interface Project {
  /** Stable UUID identity. */
  id: string;
  /** Owner key — the current OS user (from IUserContext). */
  ownerUser: string;
  /** Friendly, non-empty name (≤ 120 chars). */
  name: string;
  /** Dominant colour as a hex string (e.g. `#6aa3ff`); applied as active accent. */
  colour: string;
  /** Absolute root-folder path (not browsed this iteration). */
  rootFolder: string;
  /** Exactly one project per owner is active at a time. */
  isActive: boolean;
  /** Root-relative paths hidden from the file tree, in addition to the global
   *  excludeGlobs (004). Project-scoped; editable later. */
  hiddenPaths: string[];
  /** ISO-8601 bookkeeping timestamps. */
  createdAt: string;
  updatedAt: string;
}

/** Mutable fields accepted on create/update. */
export interface ProjectInput {
  name: string;
  colour: string;
  rootFolder: string;
}

const MAX_NAME_LENGTH = 120;
const HEX_COLOUR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Raised when project input fails validation (maps to JSON-RPC -32602). */
export class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly field: 'name' | 'colour' | 'rootFolder',
  ) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

/** Raised when a project id does not exist for the owner (maps to JSON-RPC -32004). */
export class ProjectNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Project not found: ${id}`);
    this.name = 'ProjectNotFoundError';
  }
}

/** True for a valid 3- or 6-digit hex colour (e.g. `#fff`, `#6aa3ff`). */
export function isValidHexColour(value: string): boolean {
  return HEX_COLOUR_RE.test(value);
}

/**
 * Raised when a project's root folder conflicts with another project's
 * (identical / ancestor / descendant) — FR-029, a fundamental restriction.
 */
export class ProjectFolderConflictError extends ProjectValidationError {
  constructor(
    readonly candidate: string,
    readonly conflictsWith: string,
  ) {
    super(
      `Project root folder "${candidate}" overlaps another project's folder "${conflictsWith}"`,
      'rootFolder',
    );
    this.name = 'ProjectFolderConflictError';
  }
}

/**
 * Normalise a folder path for comparison (pure — no node:path, Principle II):
 * trim, forward-slashes, collapse repeats, drop trailing slash, lowercase
 * (Windows is case-insensitive). Good enough for the exclusivity check (FR-029).
 */
export function normaliseFolder(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * True when two folders overlap exclusively: identical, or one is an ancestor
 * (parent) / descendant (subfolder) of the other (FR-029).
 */
export function isFolderConflict(a: string, b: string): boolean {
  const x = normaliseFolder(a);
  const y = normaliseFolder(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x === y) return true;
  return x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * Assert a candidate root folder does not conflict with any existing project's
 * root (excluding the project being edited via `selfId`). Throws
 * {@link ProjectFolderConflictError} on the first conflict (FR-029).
 */
export function assertFolderExclusive(
  candidate: string,
  existing: ReadonlyArray<Pick<Project, 'id' | 'rootFolder'>>,
  selfId?: string,
): void {
  for (const project of existing) {
    if (selfId && project.id === selfId) continue;
    if (isFolderConflict(candidate, project.rootFolder)) {
      throw new ProjectFolderConflictError(candidate, project.rootFolder);
    }
  }
}

/**
 * Validate and normalise project input (data-model §1): name non-empty after
 * trim and ≤ 120 chars; colour a valid hex; root folder non-empty. Returns the
 * normalised values (trimmed name/rootFolder); throws {@link ProjectValidationError}.
 */
export function validateProjectInput(input: ProjectInput): ProjectInput {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new ProjectValidationError('Project name must not be empty', 'name');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ProjectValidationError(
      `Project name must be at most ${MAX_NAME_LENGTH} characters`,
      'name',
    );
  }
  if (!isValidHexColour(input.colour)) {
    throw new ProjectValidationError(
      `Project colour must be a hex value (e.g. #6aa3ff); got "${input.colour}"`,
      'colour',
    );
  }
  const rootFolder = input.rootFolder.trim();
  if (rootFolder.length === 0) {
    throw new ProjectValidationError('Project root folder must not be empty', 'rootFolder');
  }
  return { name, colour: input.colour, rootFolder };
}

/** Identity/bookkeeping supplied by the caller (composition root injects these). */
export interface ProjectCreationContext {
  id: string;
  ownerUser: string;
  /** ISO-8601 timestamp. */
  now: string;
  /** Whether this project starts active (defaults to false). */
  isActive?: boolean;
}

/** Build a validated Project from input + injected identity/timestamps. */
export function createProject(input: ProjectInput, ctx: ProjectCreationContext): Project {
  const normalised = validateProjectInput(input);
  return {
    id: ctx.id,
    ownerUser: ctx.ownerUser,
    name: normalised.name,
    colour: normalised.colour,
    rootFolder: normalised.rootFolder,
    isActive: ctx.isActive ?? false,
    hiddenPaths: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/** Sanitise a hidden-paths list: strings only, de-duplicated, no empties. */
export function sanitiseHiddenPaths(paths: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const p of paths) {
    if (typeof p === 'string' && p.length > 0) seen.add(p);
  }
  return [...seen];
}

/** Set a project's hidden-paths list (004), bumping `updatedAt`. Pure. */
export function applyHiddenPaths(existing: Project, hiddenPaths: readonly string[], now: string): Project {
  return { ...existing, hiddenPaths: sanitiseHiddenPaths(hiddenPaths), updatedAt: now };
}

/**
 * Apply a partial edit to a project, validating the merged result and bumping
 * `updatedAt`. Pure — returns a new object, never mutates the original.
 */
export function applyProjectUpdate(
  existing: Project,
  patch: Partial<ProjectInput>,
  now: string,
): Project {
  const merged = validateProjectInput({
    name: patch.name ?? existing.name,
    colour: patch.colour ?? existing.colour,
    rootFolder: patch.rootFolder ?? existing.rootFolder,
  });
  return {
    ...existing,
    name: merged.name,
    colour: merged.colour,
    rootFolder: merged.rootFolder,
    updatedAt: now,
  };
}
