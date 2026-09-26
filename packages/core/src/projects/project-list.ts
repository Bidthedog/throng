/**
 * The Projects pane's list model (046, data-model §7). Pure.
 *
 * One module drives the tree's rows, the Next/Previous Project chords and the cog menu's enabled
 * state, so the three cannot disagree about which project is "next" (FR-011, FR-019). The shapes are
 * structural, so the renderer passes its DTOs and the daemon its domain objects without conversion.
 */

/** What the list needs of a project. The array order it arrives in IS the global position order. */
export interface ListableProject {
  id: string;
  categoryId: string;
}

/** What the list needs of a category. */
export interface ListableCategory {
  id: string;
  isDefault: boolean;
  minimised: boolean;
  createdAt: string;
}

export type ListRow<P extends ListableProject, C extends ListableCategory> =
  | {
      kind: 'category';
      category: C;
      /** Every project in the category, hidden ones included (FR-051). */
      count: number;
      /** False only for the default category, which cannot be minimised (FR-050). */
      collapsible: boolean;
    }
  | {
      kind: 'project';
      project: P;
      /**
       * The category the row is listed under, resolved by the heal rule. `''` only for a project
       * listed headerless because no default category is known (see {@link listRows}).
       */
      categoryId: string;
      /** The active project shown under its minimised category's header (FR-052). */
      pinnedActive: boolean;
    };

/** The default category first, then by `createdAt`, then by `id` (FR-056). */
function inListOrder<C extends ListableCategory>(categories: readonly C[]): C[] {
  return [...categories].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The read-time heal rule (R9): a category id naming no known category belongs to the default one.
 * `undefined` when there is no default to heal into. The one statement of the rule for core — the
 * list model and the category service's delete both read it from here.
 */
export function healCategoryId(
  categoryId: string,
  knownIds: ReadonlySet<string>,
  defaultId: string | undefined,
): string | undefined {
  return knownIds.has(categoryId) ? categoryId : defaultId;
}

/**
 * The visible rows, in list order: each category's header and then, when it is expanded, its
 * projects in position order. A minimised category shows only its header — plus the active project,
 * pinned, when it lives there (FR-052). A project naming no known category is listed under the
 * default one, the read-time heal rule, so it is never lost (R9).
 *
 * With no default category to heal into — the categories not loaded yet, or their fetch failed —
 * such projects lead the list without a header, in position order, with `categoryId` `''`. A list
 * that emptied itself because a second request was late would look like every project had gone.
 */
export function listRows<P extends ListableProject, C extends ListableCategory>(
  projects: readonly P[],
  categories: readonly C[],
  activeId: string | null,
): ListRow<P, C>[] {
  const ordered = inListOrder(categories);
  const known = new Set(ordered.map((c) => c.id));
  const defaultId = ordered.find((c) => c.isDefault)?.id;
  const resolve = (p: P): string | undefined => healCategoryId(p.categoryId, known, defaultId);

  const rows: ListRow<P, C>[] = projects
    .filter((p) => resolve(p) === undefined)
    .map((project) => ({ kind: 'project', project, categoryId: '', pinnedActive: false }));
  for (const category of ordered) {
    const members = projects.filter((p) => resolve(p) === category.id);
    rows.push({ kind: 'category', category, count: members.length, collapsible: !category.isDefault });
    const shown = category.minimised ? members.filter((p) => p.id === activeId) : members;
    for (const project of shown) {
      rows.push({ kind: 'project', project, categoryId: category.id, pinnedActive: category.minimised });
    }
  }
  return rows;
}

/** Every project a user can reach from the list, in row order — the pinned active one included. */
export function reachableProjectIds(
  rows: ReadonlyArray<ListRow<ListableProject, ListableCategory>>,
): string[] {
  return rows.flatMap((r) => (r.kind === 'project' ? [r.project.id] : []));
}

/**
 * The project Next (`+1`) or Previous (`-1`) moves to, or null to do nothing (FR-011).
 *
 * With a project active it does not wrap: null at either end, and so with fewer than two reachable.
 * With none active — after the active project was unloaded, say — there is no end to stop at, so it
 * goes to the first for `+1` and the last for `-1`, even when only one is reachable (R5; spec FR-011
 * *Recorded*). An active id the list cannot reach is treated as none active.
 */
export function stepProject(
  reachable: readonly string[],
  activeId: string | null,
  dir: 1 | -1,
): string | null {
  if (reachable.length === 0) return null;
  const index = activeId === null ? -1 : reachable.indexOf(activeId);
  if (index === -1) return (dir === 1 ? reachable[0] : reachable[reachable.length - 1]) ?? null;
  return reachable[index + dir] ?? null;
}

export type CategoryNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate' | 'tooLong' };

/** Same cap as a project's name (`project.ts`'s `MAX_NAME_LENGTH`) — hardening, no FR of its own. */
export const MAX_CATEGORY_NAME_LENGTH = 120;

/**
 * Trimmed, non-empty, at most {@link MAX_CATEGORY_NAME_LENGTH} characters, and unique among
 * `existing` ignoring case (FR-053). `selfId` is the category being renamed, which may keep — or
 * re-case — its own name.
 */
export function validateCategoryName(
  name: string,
  existing: ReadonlyArray<{ id: string; name: string }>,
  selfId?: string,
): CategoryNameResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) return { ok: false, reason: 'tooLong' };
  // `toLowerCase`, not `toLocaleLowerCase`, as every other uniqueness rule in core: the answer must
  // not depend on the machine's locale (a Turkish locale folds `I` to a dotless `ı`).
  const key = trimmed.toLowerCase();
  const clash = existing.some((c) => c.id !== selfId && c.name.trim().toLowerCase() === key);
  return clash ? { ok: false, reason: 'duplicate' } : { ok: true, name: trimmed };
}

/**
 * The global project order after `deletedId` is deleted (FR-054): its members move to directly after
 * the default category's last member, keeping their relative order, so in the default category they
 * read after its existing members. With the default category empty they keep their place. Every
 * other project keeps its position.
 */
export function mergeIntoDefault(
  orderedIds: readonly string[],
  categoryOf: (projectId: string) => string,
  deletedId: string,
  defaultId: string,
): string[] {
  const moved = orderedIds.filter((id) => categoryOf(id) === deletedId);
  if (moved.length === 0) return [...orderedIds];
  const rest = orderedIds.filter((id) => categoryOf(id) !== deletedId);
  let lastDefault = -1;
  rest.forEach((id, i) => {
    if (categoryOf(id) === defaultId) lastDefault = i;
  });
  const at = lastDefault === -1 ? orderedIds.indexOf(moved[0] as string) : lastDefault + 1;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
