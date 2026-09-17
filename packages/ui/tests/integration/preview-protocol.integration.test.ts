import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPreviewProviderRegistry,
  DEFAULT_APP_SETTINGS,
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  type AppSettings,
  type PreviewProviderDescriptor,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import {
  createPreviewProtocolHandler,
  type PreviewLookup,
  type PreviewRunRef,
} from '../../src/main/preview-protocol.js';

/**
 * T048 — the `throng-preview:` protocol handler over a REAL temp tree and the real `NodeFileSystem`
 * (044 FR-073, FR-074, FR-084; contracts/preview-ipc.md §4).
 *
 * No Electron: the handler is `(Request) => Promise<Response>`, so a WHATWG `Request` built in Node
 * is exactly what `protocol.handle` would pass it.
 *
 * The symlink case is the one a string rule cannot see. `docs/escape` is a link INSIDE the project
 * whose target is a folder OUTSIDE it, so `docs/escape/secret.png` is "inside" by its spelling and
 * outside by the file it reaches. Only a realpath of both the root and the file refuses it.
 */

/** A binary provider that exists only in this test, so the source route can be driven (SC-003). */
const testBinary: PreviewProviderDescriptor = {
  id: 'testBinary',
  displayName: 'Test binary',
  extensions: ['.pdf'],
  kind: 'binary',
  sourceMimeTypes: ['application/pdf'],
};
/** A binary provider whose listed MIME does NOT cover its own files — the source route's 415. */
const testBinaryUnlisted: PreviewProviderDescriptor = {
  id: 'testBinaryUnlisted',
  displayName: 'Test binary (unlisted)',
  extensions: ['.png'],
  kind: 'binary',
  sourceMimeTypes: ['application/pdf'],
};
const registry = createPreviewProviderRegistry([
  ...SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  testBinary,
  testBinaryUnlisted,
]);

const CAP_BYTES = 1024;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let base: string;
let root: string;
let settings: AppSettings;
let linkKind: 'dir' | 'junction' | null = null;
let fileLinkMade = false;
let handler: (request: Request) => Promise<Response>;

async function put(abs: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

/** A directory link from `link` to `target`: a symlink where permitted, else a junction (no elevation). */
async function linkDirectory(target: string, link: string): Promise<'dir' | 'junction' | null> {
  try {
    await symlink(target, link, 'dir');
    return 'dir';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
  try {
    await symlink(target, link, 'junction');
    return 'junction';
  } catch {
    return null;
  }
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'throng-preview-protocol-'));
  root = join(base, 'project');
  const outside = join(base, 'outside');
  await put(join(root, 'docs', 'readme.md'), '# Readme\n');
  await put(join(root, 'docs', 'img.png'), PNG_BYTES);
  await put(join(root, 'docs', 'page.html'), '<script>alert(1)</script>');
  await put(join(root, 'docs', 'big.png'), new Uint8Array(CAP_BYTES * 2));
  await put(join(root, 'docs', 'manual.pdf'), '%PDF-1.4\n');
  await put(join(root, 'docs', 'photo.png'), PNG_BYTES);
  await put(join(outside, 'secret.png'), PNG_BYTES);
  linkKind = await linkDirectory(outside, join(root, 'docs', 'escape'));
  // A junction cannot name a file, so this one is a symlink or nothing.
  try {
    await symlink(join(root, 'docs', 'page.html'), join(root, 'docs', 'logo.png'), 'file');
    fileLinkMade = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }

  settings = {
    ...DEFAULT_APP_SETTINGS,
    editor: { ...DEFAULT_APP_SETTINGS.editor, maxOpenFileBytes: CAP_BYTES },
  };

  const runs = new Map<string, PreviewRunRef>([
    ['p-text', { projectRoot: root, filePath: join(root, 'docs', 'readme.md'), providerId: 'markdown' }],
    ['p-bin', { projectRoot: root, filePath: join(root, 'docs', 'manual.pdf'), providerId: 'testBinary' }],
    [
      'p-bin-unlisted',
      { projectRoot: root, filePath: join(root, 'docs', 'photo.png'), providerId: 'testBinaryUnlisted' },
    ],
  ]);
  const previews: PreviewLookup = { run: (id) => runs.get(id) };
  const fs = new NodeFileSystem(
    () => Promise.reject(new Error('trash is not used by the protocol')),
    () => Promise.reject(new Error('restore is not used by the protocol')),
  );
  // Settings are read through a getter on every request (the size cap is live, like the editor's).
  handler = createPreviewProtocolHandler({ fs, previews, settings: () => settings, registry });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const asset = (id: string, rel: string): Request =>
  new Request(`throng-preview://asset/${id}/${encodeURIComponent(rel)}`);
const source = (id: string): Request => new Request(`throng-preview://source/${id}?rev=3`);

function expectHardenedHeaders(res: Response): void {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
}

describe('throng-preview: asset route (FR-074, FR-084)', () => {
  it('serves an image inside the project with its type and the hardened headers', async () => {
    const res = await handler(asset('p-text', 'docs/img.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expectHardenedHeaders(res);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('refuses a `..` escape with 403', async () => {
    const res = await handler(asset('p-text', '../outside/secret.png'));
    expect(res.status).toBe(403);
    expectHardenedHeaders(res);
  });

  it('refuses a link inside the project whose target is outside it with 403 (realpath containment)', async (ctx) => {
    if (linkKind === null) {
      ctx.skip(true, 'neither a directory symlink nor a junction could be created on this machine');
    }
    // The escape is real: the outside file's bytes ARE reachable through the link on disk, so a 403 is
    // the handler refusing, not the path failing to resolve.
    expect(new Uint8Array(await readFile(join(root, 'docs', 'escape', 'secret.png')))).toEqual(PNG_BYTES);
    const res = await handler(asset('p-text', 'docs/escape/secret.png'));
    expect(res.status).toBe(403);
    expectHardenedHeaders(res);
  });

  it('re-reads the type from the REAL name: `logo.png` linked to `page.html` is refused 415', async (ctx) => {
    if (fileLinkMade === false) {
      ctx.skip(true, 'a file symlink could not be created here (needs developer mode or elevation)');
    }
    // The link's own spelling passes the image allowlist; only the realpath shows it is HTML.
    const res = await handler(asset('p-text', 'docs/logo.png'));
    expect(res.status).toBe(415);
    expectHardenedHeaders(res);
  });

  it('answers 404 for a missing file', async () => {
    const res = await handler(asset('p-text', 'docs/missing.png'));
    expect(res.status).toBe(404);
    expectHardenedHeaders(res);
  });

  it('answers 415 for a type outside the image allowlist', async () => {
    const res = await handler(asset('p-text', 'docs/page.html'));
    expect(res.status).toBe(415);
    expectHardenedHeaders(res);
  });

  it('refuses a file over `editor.maxOpenFileBytes` with 413, read live from settings', async () => {
    const refused = await handler(asset('p-text', 'docs/big.png'));
    expect(refused.status).toBe(413);
    expectHardenedHeaders(refused);

    const previous = settings;
    settings = { ...settings, editor: { ...settings.editor, maxOpenFileBytes: CAP_BYTES * 4 } };
    try {
      expect((await handler(asset('p-text', 'docs/big.png'))).status).toBe(200);
    } finally {
      settings = previous;
    }
  });

  it('answers 404 for an unknown preview panel id', async () => {
    const res = await handler(asset('p-nobody', 'docs/img.png'));
    expect(res.status).toBe(404);
    expectHardenedHeaders(res);
  });
});

describe('throng-preview: an unexpected throw', () => {
  /*
   * Fix round 1: the lookup is `PreviewService` from u7 on, and a throw from it (or from anything else
   * outside a file read) must still answer — with the hardened headers — rather than reject the
   * handler and leave Electron to invent a response.
   */
  it('answers 404 with the hardened headers when the lookup throws', async () => {
    const throwing = createPreviewProtocolHandler({
      fs: new NodeFileSystem(
        () => Promise.reject(new Error('unused')),
        () => Promise.reject(new Error('unused')),
      ),
      previews: {
        run: () => {
          throw new Error('lookup exploded');
        },
      },
      settings: () => settings,
      registry,
    });
    for (const request of [asset('p-text', 'docs/img.png'), source('p-bin')]) {
      const res = await throwing(request);
      expect(res.status).toBe(404);
      expectHardenedHeaders(res);
    }
  });
});

describe('throng-preview: source route (FR-073)', () => {
  it('refuses the source route on a text provider with 403', async () => {
    const res = await handler(source('p-text'));
    expect(res.status).toBe(403);
    expectHardenedHeaders(res);
  });

  it("serves a binary provider's document when its MIME type is listed", async () => {
    const res = await handler(source('p-bin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expectHardenedHeaders(res);
    expect(await res.text()).toBe('%PDF-1.4\n');
  });

  it("answers 415 when the document's type is not in the provider's list", async () => {
    const res = await handler(source('p-bin-unlisted'));
    expect(res.status).toBe(415);
    expectHardenedHeaders(res);
  });

  it('answers 404 for an unknown preview panel id', async () => {
    const res = await handler(source('p-nobody'));
    expect(res.status).toBe(404);
  });
});
