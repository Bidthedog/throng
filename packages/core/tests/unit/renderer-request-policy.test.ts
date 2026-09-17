import { describe, it, expect } from 'vitest';
import { decideRendererRequest, resolvePreviewAsset } from '../../src/preview/request-policy.js';

/**
 * 044 T008 — Layer 4 of contracts/security-policy.md, and the confinement of the `throng-preview:`
 * protocol (FR-074, FR-084, FR-093).
 *
 * Layer 4 is the last line: it is what stops a request the sanitiser and the CSP both missed. So the
 * table is pinned row by row — including the rows that say ALLOW, because a filter that cancels the
 * drag ghost window's `data:` page or the renderer's own bundle is a broken application, not a
 * safer one.
 */

const RENDERER = 'C:\\Program Files\\throng\\resources\\app.asar\\dist\\renderer';
const on = { rendererDir: RENDERER, remoteImages: true };
const off = { rendererDir: RENDERER, remoteImages: false };

const RESOURCE_TYPES = ['mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr', 'media', 'webSocket', 'other'];

describe('decideRendererRequest — allowed rows', () => {
  it.each([
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer/index.html',
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer/assets/index-abc.js',
    'FILE:///c:/program files/THRONG/resources/app.asar/dist/renderer/assets/x.css',
    'file://localhost/C:/Program%20Files/throng/resources/app.asar/dist/renderer/a.woff2',
  ])('file: under the renderer directory — %s — is allowed for every resource type', (url) => {
    for (const resourceType of RESOURCE_TYPES) {
      expect(decideRendererRequest({ url, resourceType }, off), resourceType).toBe('allow');
    }
  });

  it('file: under a POSIX renderer directory is allowed', () => {
    const policy = { rendererDir: '/opt/throng/resources/app.asar/dist/renderer', remoteImages: false };
    expect(
      decideRendererRequest({ url: 'file:///opt/throng/resources/app.asar/dist/renderer/index.html', resourceType: 'mainFrame' }, policy),
    ).toBe('allow');
  });

  it.each([
    'throng-preview://asset/p1/docs/img/a.png',
    'throng-preview://source/p1?rev=3',
    'devtools://devtools/bundled/inspector.html',
    'chrome-extension://abcdef/panel.html',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:text/html;charset=utf-8,%3Cdiv%3Eghost%3C%2Fdiv%3E',
    'blob:file:///6c1f0d0e-6a4b-4b7e-9a11-2f1e2d6c9b1a',
  ])('%s is allowed for every resource type', (url) => {
    for (const resourceType of RESOURCE_TYPES) {
      expect(decideRendererRequest({ url, resourceType }, off), resourceType).toBe('allow');
    }
  });

  it('the drag ghost window’s data:text/html main frame is allowed', () => {
    expect(
      decideRendererRequest({ url: 'data:text/html,<body>ghost</body>', resourceType: 'mainFrame' }, off),
    ).toBe('allow');
  });

  it('an https image is allowed iff remote images are permitted (FR-092)', () => {
    const req = { url: 'https://img.shields.io/badge/build-passing-green.svg', resourceType: 'image' };
    expect(decideRendererRequest(req, on)).toBe('allow');
    expect(decideRendererRequest(req, off)).toBe('cancel');
  });
});

describe('decideRendererRequest — cancelled rows (FR-093)', () => {
  it('an http image is cancelled whatever the setting', () => {
    const req = { url: 'http://example.com/a.png', resourceType: 'image' };
    expect(decideRendererRequest(req, on)).toBe('cancel');
    expect(decideRendererRequest(req, off)).toBe('cancel');
  });

  it.each(RESOURCE_TYPES.filter((t) => t !== 'image'))(
    'an https %s is cancelled even with remote images on',
    (resourceType) => {
      expect(decideRendererRequest({ url: 'https://example.com/x', resourceType }, on)).toBe('cancel');
    },
  );

  it('https stylesheet, xhr and fetch are cancelled', () => {
    expect(decideRendererRequest({ url: 'https://fonts.example.com/a.css', resourceType: 'stylesheet' }, on)).toBe('cancel');
    expect(decideRendererRequest({ url: 'https://api.example.com/', resourceType: 'xhr' }, on)).toBe('cancel');
    expect(decideRendererRequest({ url: 'https://api.example.com/', resourceType: 'fetch' }, on)).toBe('cancel');
  });

  it.each([
    'file:///C:/Windows/win.ini',
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer-evil/x.js',
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer/../../secrets.json',
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer/%2e%2e/%2e%2e/secrets.json',
    // An encoded BACKSLASH traversal — Windows separates on it, so it climbs exactly as `/..` would.
    'file:///C:/Program%20Files/throng/resources/app.asar/dist/renderer/%5C..%5C..%5Csecrets.json',
    'file://evil-server/share/dist/renderer/index.html',
    'file:///C:/Program%E0%A4%A/x',
  ])('file: outside the renderer directory — %s — is cancelled', (url) => {
    expect(decideRendererRequest({ url, resourceType: 'script' }, on)).toBe('cancel');
    expect(decideRendererRequest({ url, resourceType: 'image' }, on)).toBe('cancel');
  });

  it.each(['ws://localhost:1234/', 'wss://example.com/', 'ftp://example.com/a.png', 'javascript:alert(1)', 'about:blank', 'not a url', ''])(
    '%j is cancelled',
    (url) => {
      expect(decideRendererRequest({ url, resourceType: 'image' }, on)).toBe('cancel');
      expect(decideRendererRequest({ url, resourceType: 'mainFrame' }, on)).toBe('cancel');
    },
  );
});

describe('resolvePreviewAsset — the asset route (FR-074, FR-084)', () => {
  const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const ctx = { projectRoot: 'C:\\proj', docPath: 'C:\\proj\\docs\\guide.md', mimeAllowlist: IMAGES };

  it('serves an allow-listed image inside the project', () => {
    expect(resolvePreviewAsset({ kind: 'asset', relPath: 'docs/img/a.png' }, ctx)).toEqual({
      ok: true,
      absPath: 'C:\\proj\\docs\\img\\a.png',
      mime: 'image/png',
    });
    expect(resolvePreviewAsset({ kind: 'asset', relPath: 'Assets/Logo.JPG' }, ctx)).toEqual({
      ok: true,
      absPath: 'C:\\proj\\Assets\\Logo.JPG',
      mime: 'image/jpeg',
    });
    expect(resolvePreviewAsset({ kind: 'asset', relPath: 'a/../b.svg' }, ctx)).toEqual({
      ok: true,
      absPath: 'C:\\proj\\b.svg',
      mime: 'image/svg+xml',
    });
  });

  it.each(['../outside.png', 'docs/../../outside.png', '..\\..\\outside.png', '/etc/passwd.png', 'C:/Windows/x.png', '\\\\server\\share\\x.png'])(
    '%j is 403 — outside the project',
    (relPath) => {
      expect(resolvePreviewAsset({ kind: 'asset', relPath }, ctx)).toEqual({ ok: false, status: 403 });
    },
  );

  it('a missing relPath is 404-shaped', () => {
    expect(resolvePreviewAsset({ kind: 'asset', relPath: '' }, ctx)).toEqual({ ok: false, status: 404 });
  });

  it.each(['docs/guide.md', 'tools/run.exe', 'docs/noextension', 'docs/a.png.exe'])(
    '%j is 415 — not in the allowlist',
    (relPath) => {
      expect(resolvePreviewAsset({ kind: 'asset', relPath }, ctx)).toEqual({ ok: false, status: 415 });
    },
  );

  it('works against a POSIX root', () => {
    const p = { projectRoot: '/home/u/proj', docPath: '/home/u/proj/a.md', mimeAllowlist: IMAGES };
    expect(resolvePreviewAsset({ kind: 'asset', relPath: 'img/a.gif' }, p)).toEqual({
      ok: true,
      absPath: '/home/u/proj/img/a.gif',
      mime: 'image/gif',
    });
  });
});

describe('resolvePreviewAsset — the source route (FR-073, FR-074)', () => {
  it('serves the document itself when its type is allow-listed', () => {
    const ctx = { projectRoot: 'C:\\proj', docPath: 'C:\\proj\\docs\\spec.pdf', mimeAllowlist: ['application/pdf'] };
    expect(resolvePreviewAsset({ kind: 'source' }, ctx)).toEqual({
      ok: true,
      absPath: 'C:\\proj\\docs\\spec.pdf',
      mime: 'application/pdf',
    });
  });

  it('an EMPTY allowlist is how a text provider is refused — 403', () => {
    const ctx = { projectRoot: 'C:\\proj', docPath: 'C:\\proj\\docs\\a.md', mimeAllowlist: [] };
    expect(resolvePreviewAsset({ kind: 'source' }, ctx)).toEqual({ ok: false, status: 403 });
  });

  it('a document outside the project is 403', () => {
    const ctx = { projectRoot: 'C:\\proj', docPath: 'C:\\proj-two\\spec.pdf', mimeAllowlist: ['application/pdf'] };
    expect(resolvePreviewAsset({ kind: 'source' }, ctx)).toEqual({ ok: false, status: 403 });
  });

  it('a document whose type is not allow-listed is 415', () => {
    const ctx = { projectRoot: 'C:\\proj', docPath: 'C:\\proj\\a.md', mimeAllowlist: ['application/pdf'] };
    expect(resolvePreviewAsset({ kind: 'source' }, ctx)).toEqual({ ok: false, status: 415 });
  });
});
