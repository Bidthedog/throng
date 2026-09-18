/**
 * The path spellings a platform understands (045 FR-012, FR-025, FR-026; Principle II).
 *
 * `core/src/links/**` states what a link MEANS and never how a platform spells it, so every
 * question with a drive letter, a home folder or a URI in it arrives here. That is what lets the
 * resolution rules be written once and answered on Windows today, and on macOS or Linux later,
 * without the rules changing (FR-010, FR-026).
 *
 * **Not to be confused with `core/src/explorer/path-forms.ts`**, which is #156's *Copy Path*
 * renderings — four strings describing one file. This is a port with four questions about any
 * string. They share a filename and nothing else, and neither is being folded into the other.
 *
 * Every method is TOTAL: an implementation answers `null` for a string it cannot convert and
 * throws for none of them, because callers feed it text a program printed.
 */
export interface IPathForms {
  /** The user's home folder, absolute. FR-025's `~`. */
  homeDirectory(): string;

  /**
   * A POSIX-shaped drive form to that drive's own spelling — the Git Bash `/d/x` and the WSL
   * `/mnt/d/x` both name drive `d`. Not a drive form → `null`. FR-025.
   */
  fromDriveForm(posixPath: string): string | null;

  /**
   * A `file:` URI to an absolute path. FR-012:
   *  - percent-decoded;
   *  - a host (`file://server/share/x`) becomes that network location;
   *  - no host, or `localhost`, becomes a local path.
   * Not a `file:` URI, or not convertible → `null`.
   */
  fromFileUrl(url: string): string | null;

  /** `~` or `~/x` to the home-relative absolute path. Anything else → `null`. FR-025. */
  fromHomeForm(path: string): string | null;
}
