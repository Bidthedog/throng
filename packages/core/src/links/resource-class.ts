/**
 * 045 FR-157, FR-159 — what KIND of resource a link names, which decides what following it does
 * (data-model §16.2, §16.9; contracts `link-resolution.md` §9.3).
 *
 * | Class | Recognised as | Route |
 * |---|---|---|
 * | `web` | `http` / `https` | the OS default browser |
 * | `loopback` | web to `localhost`, `127.0.0.1`, `[::1]` | as web — named so tests can name it |
 * | `unc` | `\\server\share\…`, `//server/share/…`, a `FileSystem::` qualified one | OS Explorer, or throng in the project |
 * | `onDevice` | a `file:` URI, and every other path spelling | as UNC |
 * | `protocol` | a scheme on the allowlist | that scheme's OS handler |
 *
 * `null` is "not a link": empty, malformed, a scheme not on the allowlist, a refused one, or a Win32
 * DEVICE-namespace spelling (`\\?\…`, `\\.\pipe\…`) — see {@link isDeviceNamespacePath} for why that
 * is refused rather than supported (review round four, M2).
 *
 * ══ THE ORDER IS THE POLICY ══
 *
 * `http`, `https` and `file` are decided first, before either set is read: `file` is on-device (class 3)
 * and is NOT in the set classification reads — refusing a `file:` URI is FR-037's rule at the external
 * opener, not a drawing rule. Every other scheme must be on the allowlist AND not refused, and refused is
 * applied AFTER the allowlist, so allowlisting `javascript` or a platform's `ms-msdt` does nothing.
 *
 * This is the ONE scheme gate (plan *Corrections after analysis*, fourth pass): every surface asks it, so
 * a terminal, an editor and a hyperlink target cannot disagree about what a scheme is. Pure and total.
 */
import { isDeviceNamespacePath } from './sanitise.js';

export type ResourceClass = 'web' | 'loopback' | 'unc' | 'onDevice' | 'protocol';

/** Two or more characters: a letter and a colon alone is a drive form, which is a path. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]+):/;

/** D12 / FR-003g: PowerShell's provider qualifier, which a UNC location may carry. */
const PROVIDER_QUALIFIER = /^(?:Microsoft\.PowerShell\.Core\\)?FileSystem::/i;

/** A server and the separator after it: `\\server\`, `//server/`, and either mixed. */
const UNC = /^[\\/]{2}[^\\/]+[\\/]/;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resourceClass(
  target: string,
  allowlist: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): ResourceClass | null {
  const trimmed = target.trim();
  if (trimmed.length === 0) return null;
  // M2: before the five classes, because the device namespace matches the UNC shape below and would
  // otherwise answer `unc` — sending a caller looking for a folder that cannot be opened, spelled in
  // the one form Win32 does not normalise.
  if (isDeviceNamespacePath(trimmed)) return null;

  // A qualified location is a path, whatever `FileSystem:` looks like to the scheme test.
  const unqualified = trimmed.replace(PROVIDER_QUALIFIER, '');
  if (unqualified !== trimmed) return UNC.test(unqualified) ? 'unc' : 'onDevice';

  const text = trimmed;
  const scheme = SCHEME.exec(text)?.[1].toLowerCase();
  if (scheme === undefined) return UNC.test(text) ? 'unc' : 'onDevice';
  if (scheme === 'file') return 'onDevice';
  if (scheme === 'http' || scheme === 'https') return webClass(text);
  if (!allowlist.has(scheme) || refused.has(scheme)) return null;
  return 'protocol';
}

function webClass(text: string): 'web' | 'loopback' | null {
  let host: string;
  try {
    host = new URL(text).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.length === 0) return null;
  return LOOPBACK_HOSTS.has(host) ? 'loopback' : 'web';
}
