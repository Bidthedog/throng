/**
 * The renderer request filter's decision, and the `throng-preview:` protocol's confinement (044,
 * FR-074, FR-084, FR-093, contracts/security-policy.md Layer 4, research R7).
 *
 * Both are the LAST line of their defence. The sanitiser and the CSP should already have stopped a
 * hostile request; this is what still stops it when one of them did not. So neither function sees a
 * provider, a DOM or a filesystem — main's protocol handler and `webRequest` hook call them with plain
 * values and act on the answer, which keeps the decision testable row by row.
 *
 * Pure: no OS, no DOM, no `node:path`.
 */
import { isUnderPath } from '../fs/path-id.js';
import { relPathUnderRoot } from '../explorer/path-rules.js';
import { resolveAgainst, separatorOf } from './path-resolve.js';

/** Schemes that are never a network request from a document (Layer 4's allow rows). */
const ALWAYS_ALLOWED = new Set(['throng-preview', 'devtools', 'chrome-extension', 'data', 'blob']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Layer 4 (contracts/security-policy.md), for one request that carries a `webContents`.
 *
 * `policy.rendererDir` is the directory the renderer's own files load from — main resolves it (the
 * packaged `dist/renderer` directory) and passes it in, so this function has no notion of where the
 * application is installed. A `file:` URL is allowed only beneath it; `https:` only for an image, and
 * only while remote images are permitted; `throng-preview:`, `devtools:`, `chrome-extension:`,
 * `data:` and `blob:` always (the drag ghost window loads a `data:text/html` page); everything else
 * is cancelled.
 */
export function decideRendererRequest(
  req: { url: string; resourceType: string },
  policy: { rendererDir: string; remoteImages: boolean },
): 'allow' | 'cancel' {
  const scheme = SCHEME.exec(req.url)?.[1].toLowerCase();
  if (scheme === undefined) return 'cancel';
  if (ALWAYS_ALLOWED.has(scheme)) return 'allow';
  if (scheme === 'https') return req.resourceType === 'image' && policy.remoteImages ? 'allow' : 'cancel';
  if (scheme === 'file') {
    const path = pathOfFileUrl(req.url);
    // `isUnderPath` refuses a `..` segment on either separator, so a decoded `%2e%2e` or `%5C..`
    // cannot climb out of the directory.
    return path !== null && isUnderPath(path, policy.rendererDir) ? 'allow' : 'cancel';
  }
  return 'cancel';
}

/** The filesystem path a `file:` URL names, percent-decoded; `null` when malformed. */
function pathOfFileUrl(url: string): string | null {
  const rest = url.slice('file:'.length);
  if (!rest.startsWith('//')) return null;
  const authorityAndPath = rest.slice(2).replace(/[?#].*$/, '');
  const slash = authorityAndPath.indexOf('/');
  const host = slash < 0 ? authorityAndPath : authorityAndPath.slice(0, slash);
  const encoded = slash < 0 ? '' : authorityAndPath.slice(slash);
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (host !== '' && host.toLowerCase() !== 'localhost') return `//${host}${path}`;
  // `file:///C:/x` carries a slash before the drive letter that is not part of the path.
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

/**
 * The MIME type the protocol serves a file as, by extension. Only what a preview can display: the
 * image formats Chromium renders in `<img>`, and PDF for a binary provider (#388). The ALLOWLIST the
 * caller passes decides what is actually served; this table only names the type.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

function mimeOf(path: string): string | undefined {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? MIME_BY_EXTENSION[name.slice(dot).toLowerCase()] : undefined;
}

export type PreviewAssetResolution =
  | { ok: true; absPath: string; mime: string }
  | { ok: false; status: 403 | 404 | 415 };

/**
 * What a `throng-preview:` request may serve (FR-074, FR-084).
 *
 * `mimeAllowlist` is the image allowlist for the asset route and the provider's `sourceMimeTypes` for
 * the source route; the caller chooses it, so this function never sees a provider. An EMPTY allowlist
 * for the source route is how a text provider is refused.
 *
 * - `asset`: `relPath` is relative to the project root. Empty → 404; absolute, or resolving outside
 *   the project → 403; a type not in the allowlist → 415.
 * - `source`: the document itself. An empty allowlist, or a document outside the project → 403; a
 *   type not in the allowlist → 415.
 *
 * Existence on disk is the caller's to establish — this is a rule about paths, not a filesystem.
 *
 * ══ THE CALLER MUST REALPATH AND RE-CHECK (contracts/preview-ipc.md §4) ══
 *
 * Containment here is a STRING decision, so it cannot see a symlink or a junction: `docs/link.png`
 * is "inside the project" by its spelling while the file it reaches may be anywhere on the disk. An
 * `ok` result is therefore necessary, not sufficient. Before serving a byte, main must `realpath`
 * BOTH the project root and the returned `absPath` and confirm the real path is still under the real
 * root — refusing with 403 when it is not — or a link planted inside a repository reads outside it
 * (FR-074, Principle I).
 */
export function resolvePreviewAsset(
  route: { kind: 'asset'; relPath: string } | { kind: 'source' },
  ctx: { projectRoot: string; docPath: string; mimeAllowlist: readonly string[] },
): PreviewAssetResolution {
  let absPath: string;
  if (route.kind === 'source') {
    if (ctx.mimeAllowlist.length === 0) return { ok: false, status: 403 };
    if (relPathUnderRoot(ctx.projectRoot, ctx.docPath) === null || !isUnderPath(ctx.docPath, ctx.projectRoot)) {
      return { ok: false, status: 403 };
    }
    absPath = ctx.docPath;
  } else {
    if (route.relPath.length === 0) return { ok: false, status: 404 };
    if (/^[\\/]/.test(route.relPath) || SCHEME.test(route.relPath)) return { ok: false, status: 403 };
    const resolved = resolveAgainst(ctx.projectRoot, route.relPath, separatorOf(ctx.projectRoot));
    if (resolved === null || relPathUnderRoot(ctx.projectRoot, resolved) === null) {
      return { ok: false, status: 403 };
    }
    absPath = resolved;
  }

  const mime = mimeOf(absPath);
  return mime !== undefined && ctx.mimeAllowlist.includes(mime)
    ? { ok: true, absPath, mime }
    : { ok: false, status: 415 };
}
