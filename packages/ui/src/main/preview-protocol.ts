/**
 * The `throng-preview:` protocol handler (044 FR-073, FR-074, FR-084; contracts/preview-ipc.md §4,
 * research R7).
 *
 * Two routes, both keyed by a PREVIEW PANEL ID that main already knows:
 *
 *   throng-preview://asset/<previewPanelId>/<percent-encoded root-relative path>   an image beside the document
 *   throng-preview://source/<previewPanelId>?rev=<n>                              a binary provider's document
 *
 * The URL never names a project root or a document. Both come from main's own run for that panel
 * ({@link PreviewLookup}), so a renderer cannot point this at an arbitrary folder by writing a URL.
 *
 * ══ CONTAINMENT IS DECIDED TWICE ══
 *
 * `resolvePreviewAsset` (core) decides on the SPELLING of the path. A link planted inside a
 * repository — a symlink or a junction — is inside by its spelling and may reach anywhere on the disk.
 * So once the spelling passes, the root and the file are both realpath'd and the same decision is made
 * again over the REAL values. The second pass also re-reads the type from the real name, so
 * `docs/logo.png` linked to `docs/page.html` is refused 415 rather than served as an image.
 *
 * No Electron: `(Request) => Promise<Response>`, which is exactly what `protocol.handle` takes, and what
 * `preview-protocol.integration.test.ts` drives over a real temp tree.
 */
import {
  relPathUnderRoot,
  resolvePreviewAsset,
  type AppSettings,
  type IFileSystem,
  type PreviewProviderRegistry,
} from '@throng/core';

/** The scheme, without its colon. Registered privileged in `main.ts` before `app.ready`. */
export const PREVIEW_SCHEME = 'throng-preview';

/**
 * The asset route's image allowlist, by MIME type (contracts/preview-ipc.md §4: `.png .jpg .jpeg .gif
 * .webp .avif .bmp .ico .svg`). The extension-to-type table is core's; this names which of its types an
 * `<img>` in a preview may load. `image/apng` and `application/pdf` are deliberately absent.
 */
export const PREVIEW_IMAGE_MIME_ALLOWLIST: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/svg+xml',
];

/** The three fields of a preview run the protocol needs (data-model §10 `PreviewRun`). */
export interface PreviewRunRef {
  /** Resolved in main, never from the renderer. */
  projectRoot: string;
  /** The document the preview currently shows. */
  filePath: string;
  providerId: string;
}

/** Main's preview runs, by preview panel id. `PreviewService` implements it (u7). */
export interface PreviewLookup {
  run(previewPanelId: string): PreviewRunRef | undefined;
}

export interface PreviewProtocolDeps {
  fs: Pick<IFileSystem, 'realpath' | 'stat' | 'size' | 'readBytes'>;
  previews: PreviewLookup;
  /** Read on EVERY request, so a changed `editor.maxOpenFileBytes` applies to the next image. */
  settings: () => AppSettings;
  registry: PreviewProviderRegistry;
}

/**
 * Carried by every response, refusals included. `sandbox` means that even a document reached by
 * navigating straight to one of these URLs gets an opaque origin with no script; `nosniff` means a
 * file is only ever what its allowlisted type says; `no-store` means an image edited on disk is read
 * afresh rather than served from a cache that outlived it.
 */
const HARDENED_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': 'sandbox',
  'Cache-Control': 'no-store',
};

function refuse(status: 403 | 404 | 413 | 415): Response {
  return new Response(null, { status, headers: HARDENED_HEADERS });
}

type Route = { kind: 'asset'; panelId: string; relPath: string } | { kind: 'source'; panelId: string };

/** The route a URL names, or `null` when it names neither. Never throws. */
function parseRoute(url: string): Route | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PREVIEW_SCHEME}:`) return null;
  const path = parsed.pathname.replace(/^\//, '');
  try {
    if (parsed.hostname === 'source') {
      return path.length > 0 && !path.includes('/')
        ? { kind: 'source', panelId: decodeURIComponent(path) }
        : null;
    }
    if (parsed.hostname === 'asset') {
      const slash = path.indexOf('/');
      if (slash <= 0) return null;
      // The root-relative path is decoded WHOLE, so an encoded `..%2F` arrives as `../` and meets the
      // containment rule, rather than slipping past it as one opaque segment.
      return {
        kind: 'asset',
        panelId: decodeURIComponent(path.slice(0, slash)),
        relPath: decodeURIComponent(path.slice(slash + 1)),
      };
    }
  } catch {
    return null; // a malformed percent escape
  }
  return null;
}

export function createPreviewProtocolHandler(
  deps: PreviewProtocolDeps,
): (request: Request) => Promise<Response> {
  const serve = serveWith(deps);
  // ONE catch for the whole request. A missing file, an unreadable link and a lookup that throws all
  // answer the same way — 404 with the hardened headers — rather than rejecting the handler and leaving
  // Electron to fail the load with a response nobody chose.
  return async (request) => {
    try {
      return await serve(request);
    } catch {
      return refuse(404);
    }
  };
}

function serveWith(deps: PreviewProtocolDeps): (request: Request) => Promise<Response> {
  const { fs, previews, settings, registry } = deps;

  return async (request) => {
    const route = parseRoute(request.url);
    if (route === null) return refuse(404);
    const run = previews.run(route.panelId);
    if (run === undefined) return refuse(404);

    // The source route serves only what a BINARY provider lists; a text provider's empty list is how
    // core refuses it (403), so a text preview can never be made to hand its document over as bytes.
    const provider = registry.get(run.providerId);
    const mimeAllowlist =
      route.kind === 'asset'
        ? PREVIEW_IMAGE_MIME_ALLOWLIST
        : provider?.kind === 'binary'
          ? (provider.sourceMimeTypes ?? [])
          : [];
    // Pass 1 — the spelling.
    const spelled = resolvePreviewAsset(
      route.kind === 'asset' ? { kind: 'asset', relPath: route.relPath } : { kind: 'source' },
      { projectRoot: run.projectRoot, docPath: run.filePath, mimeAllowlist },
    );
    if (!spelled.ok) return refuse(spelled.status);

    // A path that does not exist fails here, and the caller's catch answers 404.
    const realRoot = await fs.realpath(run.projectRoot);
    const realPath = await fs.realpath(spelled.absPath);

    // Pass 2 — the real paths. A link that leaves the project is refused here, however it was spelled.
    const realRel = relPathUnderRoot(realRoot, realPath);
    if (realRel === null) return refuse(403);
    const real = resolvePreviewAsset(
      route.kind === 'asset' ? { kind: 'asset', relPath: realRel } : { kind: 'source' },
      { projectRoot: realRoot, docPath: realPath, mimeAllowlist },
    );
    if (!real.ok) return refuse(real.status);

    // Read the REAL path itself — the one the containment decision was made about — never a re-spelling.
    if ((await fs.stat(realPath)).kind !== 'file') return refuse(404);
    if ((await fs.size(realPath)) > settings().editor.maxOpenFileBytes) return refuse(413);
    const bytes = await fs.readBytes(realPath);
    // The cap again, on what was actually read: a file that grew between the size check and the read
    // is refused rather than served past the limit.
    if (bytes.byteLength > settings().editor.maxOpenFileBytes) return refuse(413);

    // A file read is backed by an ordinary ArrayBuffer, never a SharedArrayBuffer; `IFileSystem` types
    // it as the wider `ArrayBufferLike`, which `BodyInit` does not accept.
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { ...HARDENED_HEADERS, 'Content-Type': real.mime },
    });
  };
}
