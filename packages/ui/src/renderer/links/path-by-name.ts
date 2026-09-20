import { linkReadoutTarget } from '@throng/core';

/**
 * 045 FR-155, FR-167a, FR-168, FR-176 (review round four, I1/I2) — the path SPELLINGS a link surface
 * can read without asking anything: the one place the renderer decides what a link's text names
 * before main resolves it.
 *
 * ══ WHY IT IS HERE AND NOT IN CORE ══
 *
 * `core/src/links/resolve.ts` states the real ordering rules and asks `IPathForms` for every spelling
 * with a drive letter, a home folder or a mount point in it (Principle II) — and
 * `links-no-os-names.test.ts` fails the build for a `:\` or a `/mnt/` appearing anywhere under
 * `core/src/links`. The renderer has no `IPathForms`: drawing, hovering and wording a link must cost
 * nothing (FR-155), so no surface may wait on main to say what it is pointing at. That leaves the
 * by-name subset, and it belongs on this side of the port rather than smuggled into core.
 *
 * ══ WHAT IS DECIDABLE BY NAME, AND WHAT IS NOT ══
 *
 * Decidable: a drive path, a UNC location, a `file:` URI, a Git Bash / WSL drive form (FR-176 states
 * `/d/git/x.ts` IS `D:\git\x.ts` in as many words — so there is no disk access to trade away, and the
 * by-name trade R35/FR-168a/FR-168b accepts does not cover it), and FR-024's rule that any OTHER
 * rooted path reads against the project root first.
 *
 * Not decidable: `~` (the home folder is the platform's, `IPathForms.fromHomeForm`) and a rooted path
 * that only the POSIX layer's mount table explains (FR-151). Both are shown AS WRITTEN rather than
 * joined onto a base they do not mean — the failure this module exists to stop is a readout naming a
 * file the click will never open.
 *
 * The join itself is still core's `linkReadoutTarget`, so `..`/`.` and the drive/UNC-aware split have
 * exactly one implementation (Principle VIII).
 */

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^[\\/]{2}[^\\/]/;
const ROOTED = /^[\\/]/;
const HOME_FORM = /^~(?:[\\/]|$)/;

/**
 * FR-176 / FR-174 — a POSIX-shaped drive form (`/d/…`, `/mnt/d/…`) as the drive it names.
 *
 * A separator must FOLLOW the volume: a bare `/c` is an ordinary rooted path, so `dir /c` never opens
 * a drive. `IPathForms.fromDriveForm` is the authority for a real resolution; this is the same grammar
 * applied where no port is reachable.
 */
export function driveFormByName(text: string): string | null {
  const match = /^\/(?:mnt\/)?([A-Za-z])(?=[\\/])/.exec(text);
  if (match === null) return null;
  const rest = text.slice(match[0].length).replace(/\//g, '\\');
  return `${match[1]!.toUpperCase()}:${rest.length > 0 ? rest : '\\'}`;
}

/** The location an absolute spelling names, or `null` for anything relative. No disk, no platform. */
export function absolutePathByName(text: string): string | null {
  if (DRIVE_PATH.test(text) || UNC_PATH.test(text)) return text;
  const drive = driveFormByName(text);
  if (drive !== null) return drive;
  const url = /^file:(\/\/[^/]*)?(\/.*)$/i.exec(text);
  if (url === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(url[2] ?? '');
  } catch {
    return null;
  }
  const host = (url[1] ?? '').slice(2);
  if (host.length > 0 && host.toLowerCase() !== 'localhost') return `//${host}${path}`;
  // R15 / FR-153: a hostless or `localhost` URI's path is read as that path written bare — which
  // includes the drive forms above, so `file:///d/x` is `D:\x` exactly as `/d/x` is.
  if (/^\/[A-Za-z]:/.test(path)) return path.slice(1);
  return driveFormByName(path);
}

export interface LinkReadingSite {
  /** FR-022 / FR-023: the editor's own folder, or the terminal's live cwd. */
  readonly baseDirectory?: string | null;
  /** The owning project's root, or absent for a panel with none (R11). */
  readonly projectRoot?: string | null;
}

/**
 * FR-167a — what the status bar and the hover title name, which must be somewhere the click GOES.
 *
 * The same order `resolveCandidate` puts its readings in, minus the steps that need the platform:
 *
 *   1. an absolute spelling, drive forms included → itself (R2, FR-176 — the project-root reading is
 *      NOT tried for a drive form);
 *   2. a home form → as written (FR-025 is `IPathForms`');
 *   3. any other rooted path → AS WRITTEN (see below);
 *   4. relative → the base directory, else the project root (R5 / R10);
 *   5. nothing to resolve against → as written.
 *
 * ══ WHY STEP 3 NAMES NOTHING (round five, reported 2026-09-20) ══
 *
 * It used to answer the PROJECT ROOT, on R6/FR-024's authority, and that was a guess dressed as an
 * answer. `/tmp` read out as `<project>\tmp` and opened `…\AppData\Local\Temp`; `/etc/hosts` read out
 * the same way and opened the Git installation's `etc\hosts`. The maintainer's rule: the title and
 * the status bar always represent where the link will take the user to.
 *
 * R6 is not wrong — the project root really is tried FIRST — but "tried first" is not "where it
 * goes". `resolveCandidate` falls through to `IPathForms.fromMountTable` when that reading does not
 * exist, and which one wins is a fact about the DISK. A hover resolves nothing by design
 * (`HoveredLink`: "nothing is resolved until it is followed"), so this function cannot know, and by
 * NAME `/tmp` is indistinguishable from `/help`, which really does read against the project root.
 *
 * So it names no location at all rather than the wrong one. The text as written is always true: it
 * is what the link says. This is the rule this module's header already stated for the undecidable
 * cases — "shown AS WRITTEN rather than joined onto a base they do not mean" — now applied to the
 * case that needed it.
 */
export function linkFirstReadingByName(args: LinkReadingSite & { readonly text: string }): string {
  const { text } = args;
  if (text.length === 0) return text;
  const absolute = absolutePathByName(text);
  if (absolute !== null) return absolute;
  if (HOME_FORM.test(text)) return text;
  if (ROOTED.test(text)) return text;
  const base = nonEmpty(args.baseDirectory) ?? nonEmpty(args.projectRoot);
  return base === null ? text : linkReadoutTarget(text, base);
}

function nonEmpty(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.length === 0 ? null : value;
}
