/**
 * Whether a renderer-supplied URL is safe to hand to `shell.openExternal` (020 FR-003a; 024 US7).
 *
 * The About window opens licence/project links, and a terminal (024 US7) opens URLs printed in its
 * output. Both route here, so the main process must refuse anything but `http(s)://` — never
 * `javascript:`, `file:`, `data:` or a shell path — so a crafted manifest entry or a hostile terminal
 * URL cannot run code or open a local file. 024 widened this from https-only to http OR https, which
 * real-world links use; the scheme allow-list is the whole guard.
 */
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}
