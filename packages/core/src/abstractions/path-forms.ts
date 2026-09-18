/**
 * The path spellings a platform understands (045 FR-012, FR-025, FR-026; Principle II).
 *
 * `core/src/links/**` states what a link MEANS and never how a platform spells it, so every
 * question with a drive letter, a home folder or a URI in it arrives here. That is what lets the
 * resolution rules be written once and answered on Windows today, and on macOS or Linux later,
 * without the rules changing (FR-010, FR-026).
 *
 * **Not to be confused with `core/src/explorer/path-forms.ts`**, which is #156's *Copy Path*
 * renderings — four strings describing one file. This is a port of questions about any string.
 * They share a filename and nothing else, and neither is being folded into the other.
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

  /**
   * A rooted POSIX path through the POSIX layer's own mount table — its install root for `/` and
   * the mount points it declares (FR-151). A drive form (`fromDriveForm`'s), a path that is not
   * rooted, or a platform with no such layer installed → `null`.
   */
  fromMountTable(posixPath: string): string | null;

  /**
   * A rooted path with no volume (`/tmp`, `\tmp`) qualified with the volume of `anchor` — an
   * absolute location, typically the panel's base directory or project root (FR-152). An anchor
   * that is not absolute has no volume to lend → `null`, as does a path that is not rooted.
   */
  qualifyRooted(rootedPath: string, anchor: string): string | null;

  /**
   * The decoded path inside a `file:` URI with no host or host `localhost`, exactly as spelled,
   * when it is NOT already a platform-qualified location (`file:///c/x` → `/c/x`) — so the caller
   * can resolve it as the same text written bare (FR-153). A qualified path, a hosted URI, or not a
   * `file:` URI → `null`, and `fromFileUrl` is the answer.
   */
  fileUrlLocalPath(url: string): string | null;

  /**
   * For a `localhost` URI whose first segment is not a volume (`file://localhost/C$/x`), the
   * loopback NETWORK location that segment may name, beginning with the host (FR-153). Anything
   * else → `null`.
   */
  loopbackFromFileUrl(url: string): string | null;
}
