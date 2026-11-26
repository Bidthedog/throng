/**
 * The `throng-help:` protocol handler (080 FR-049, FR-050, FR-052): the guide shipped with the app, read-only.
 *
 *   throng-help://app/<path>    a file below the bundle (`packages/ui/dist/help`); a directory serves its index.html
 *
 * Only the Help window's own session handles the scheme, so no other window can load it. Containment is decided on
 * the spelling (the decoded path must stay below the root) and again on the real path, so a link planted in the
 * bundle cannot reach elsewhere. Every response carries {@link HELP_CSP}, which allows nothing remote.
 *
 * When the bundle is missing (a copy built without the guide), an HTML request is answered with a page saying so and
 * how to build it, and the condition is logged once (FR-052).
 *
 * No Electron: `(Request) => Promise<Response>`, which is what `protocol.handle` takes.
 */
import { WEBSITE_ROOT, logExpected } from '@throng/core';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/** The scheme, without its colon. Registered privileged in `main.ts` before `app.ready`. */
export const HELP_SCHEME = 'throng-help';

/** FR-050 — nothing remote: the guide's own files, inline styles (Pagefind's UI), and Pagefind's WebAssembly. */
export const HELP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const headers = (type: string): Record<string, string> => ({ 'content-type': type, 'content-security-policy': HELP_CSP });

const notFound = (): Response => new Response('Not found', { status: 404, headers: headers('text/plain; charset=utf-8') });

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** FR-052 — what the Help window shows when this copy was built without the guide. */
function missingPage(root: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Help is not built</title>
<style>body{font:15px system-ui,sans-serif;margin:48px;max-width:40em;line-height:1.5}code{font-family:monospace}</style></head>
<body><h1>The guide is not in this copy of throng</h1>
<p>Help shows the guide that is built with throng, and this copy was built without it. It looks for it in:</p>
<p><code>${escape(root)}</code></p>
<p>Build it with <code>npm run build</code> (or <code>npm run build:help</code> on its own), then open Help again.</p>
</body></html>`;
  return new Response(html, { status: 404, headers: headers('text/html; charset=utf-8') });
}

export interface HelpProtocolDeps {
  /** The bundle's folder. */
  readonly root: string;
  /** One line to the diagnostic log. */
  readonly log: (line: string) => void;
  /**
   * FR-065 — the build's website. The bundle is built for throng-ide.com; any other root (a development build's
   * local preview) replaces it in every page, so the canonical link the popover reads and every absolute link agree.
   */
  readonly websiteRoot?: string;
}

export function createHelpProtocolHandler({ root, log, websiteRoot = WEBSITE_ROOT }: HelpProtocolDeps): (request: Request) => Promise<Response> {
  const top = resolve(root);
  let reportedMissing = false;

  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return notFound();
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch (error) {
      logExpected('help-protocol: decode', 'a malformed escape in a guide URL answers 404', error);
      return notFound();
    }
    // By spelling: the decoded path must stay below the bundle.
    let file = resolve(top, `.${path.startsWith('/') ? path : `/${path}`}`);
    if (file !== top && !file.startsWith(top + sep)) return notFound();

    const bundle = await stat(top).catch((error: unknown) => {
      logExpected('help-protocol: stat bundle', 'a copy built without the guide shows how to build it (FR-052)', error);
      return null;
    });
    if (!bundle?.isDirectory()) {
      if (!reportedMissing) {
        reportedMissing = true;
        log(`help: the guide is not built into this copy (looked in ${top}); Help shows how to build it`);
      }
      return path.endsWith('/') || extname(path) === '.html' || extname(path) === '' ? missingPage(top) : notFound();
    }

    const entry = await stat(file).catch((error: unknown) => {
      logExpected('help-protocol: stat', 'a guide request for a path the bundle does not hold answers 404', error);
      return null;
    });
    if (path.endsWith('/') || entry?.isDirectory()) file = join(file, 'index.html');
    // By real path: a link inside the bundle must not lead out of it.
    const real = await realpath(file).catch((error: unknown) => {
      logExpected('help-protocol: realpath', 'a guide request for a file the bundle does not hold answers 404', error);
      return null;
    });
    if (real === null) return notFound();
    const realTop = await realpath(top);
    if (!real.startsWith(realTop + sep)) return notFound();
    const body = await readFile(real).catch((error: unknown) => {
      logExpected('help-protocol: read', 'a guide file that cannot be read answers 404', error);
      return null;
    });
    if (body === null) return notFound();
    if (websiteRoot !== WEBSITE_ROOT && extname(real).toLowerCase() === '.html') {
      const page = body.toString('utf8').replaceAll(WEBSITE_ROOT, websiteRoot);
      return new Response(page, { status: 200, headers: headers(TYPES['.html'] ?? 'text/html') });
    }
    return new Response(body, { status: 200, headers: headers(TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream') });
  };
}
