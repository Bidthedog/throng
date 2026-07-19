/**
 * Whether a renderer-supplied URL is safe to hand to `shell.openExternal` (020, FR-003a).
 *
 * The About window opens the AGPL licence link and third-party project/licence links in the user's
 * browser. Those URLs originate from the third-party licence manifest, so the main process must
 * refuse anything but `https://` — never `javascript:`, `file:`, `http:` or a shell path — so a
 * crafted manifest entry cannot run code or open a local file. https-only is the whole guard.
 */
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\//i.test(url);
}
