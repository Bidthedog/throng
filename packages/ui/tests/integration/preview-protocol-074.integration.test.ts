/**
 * 074 — the preview protocol's per-provider extensions, over a real temp tree: a source capped by its provider's
 * own Maximum file size (FR-012), asset types widened for one provider's runs only (FR-072), the `follow` route's
 * 204 (research R6), and `readPreviewSource` answering through the same handler (R4).
 *
 * Layer: integration — the cap and the MIME decision are taken on a real file's real path and size.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPreviewProviderRegistry,
  DEFAULT_APP_SETTINGS,
  previewSettingsDefaults,
  type AppSettings,
  type PreviewProviderDescriptor,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { createPreviewProtocolHandler, readPreviewSource, type PreviewRunRef } from '../../src/main/preview-protocol.js';

const capped: PreviewProviderDescriptor = {
  id: 'capped',
  displayName: 'Capped',
  extensions: ['.pdf'],
  kind: 'binary',
  sourceMimeTypes: ['application/pdf'],
  maxFileBytesSetting: 'maxFileBytes',
  settings: [{ leaf: 'maxFileBytes', label: 'Maximum file size', description: 'd', control: 'number', storedUnit: 'bytes', default: 16 }],
};
const page: PreviewProviderDescriptor = {
  id: 'page',
  displayName: 'Page',
  extensions: ['.page'],
  kind: 'text',
  assetMimeTypes: ['text/css'],
};
const other: PreviewProviderDescriptor = { id: 'other', displayName: 'Other', extensions: ['.other'], kind: 'text' };
const registry = createPreviewProviderRegistry([capped, page, other]);

let base: string;
let root: string;
let handler: (request: Request) => Promise<Response>;

async function put(abs: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'throng-preview-protocol-074-'));
  root = join(base, 'project');
  await put(join(root, 'small.pdf'), new Uint8Array(8));
  await put(join(root, 'large.pdf'), new Uint8Array(64));
  await put(join(root, 'site.page'), '<p>x</p>');
  await put(join(root, 'site.other'), 'x');
  await put(join(root, 'css', 'site.css'), 'body { color: red }');
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    editor: { ...DEFAULT_APP_SETTINGS.editor, previews: previewSettingsDefaults(registry), maxOpenFileBytes: 1_000_000 },
  };
  const runs = new Map<string, PreviewRunRef>([
    ['small', { projectRoot: root, filePath: join(root, 'small.pdf'), providerId: 'capped' }],
    ['large', { projectRoot: root, filePath: join(root, 'large.pdf'), providerId: 'capped' }],
    ['page', { projectRoot: root, filePath: join(root, 'site.page'), providerId: 'page' }],
    ['other', { projectRoot: root, filePath: join(root, 'site.other'), providerId: 'other' }],
  ]);
  const fs = new NodeFileSystem(
    () => Promise.reject(new Error('unused')),
    () => Promise.reject(new Error('unused')),
  );
  handler = createPreviewProtocolHandler({ fs, previews: { run: (id) => runs.get(id) }, settings: () => settings, registry });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const source = (id: string): Request => new Request(`throng-preview://source/${id}?rev=1`);
const asset = (id: string, rel: string): Request => new Request(`throng-preview://asset/${id}/${encodeURIComponent(rel)}`);

describe('the source route caps by the provider’s own Maximum file size (FR-012)', () => {
  it('serves a file within the provider limit, though far below the editor limit', async () => {
    expect((await handler(source('small'))).status).toBe(200);
  });

  it('refuses a file over the provider limit with 413', async () => {
    expect((await handler(source('large'))).status).toBe(413);
  });
});

describe('asset types widened for one provider’s runs only (FR-072)', () => {
  it('serves a stylesheet to the provider that lists text/css', async () => {
    const res = await handler(asset('page', 'css/site.css'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
  });

  it('refuses the same stylesheet to any other provider’s run (415)', async () => {
    expect((await handler(asset('other', 'css/site.css'))).status).toBe(415);
  });
});

describe('the follow route (research R6)', () => {
  it('answers 204 with the hardened headers, whatever it names', async () => {
    const res = await handler(new Request('throng-preview://follow/page?href=https%3A%2F%2Fexample.test'));
    expect(res.status).toBe(204);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('readPreviewSource answers through the same handler (R4)', () => {
  it('returns the bytes and type of a source the route serves', async () => {
    const read = await readPreviewSource(handler, 'small');
    expect(read).toMatchObject({ ok: true, mime: 'application/pdf' });
    expect(read.ok && read.bytes.byteLength).toBe(8);
  });

  it('reads one asset of the run, confined as the asset route confines it', async () => {
    const read = await readPreviewSource(handler, 'page', 'css/site.css');
    expect(read).toMatchObject({ ok: true, mime: 'text/css' });
    expect(await readPreviewSource(handler, 'page', '../outside.css')).toMatchObject({ ok: false });
  });

  it('returns the refusal the route gave', async () => {
    expect(await readPreviewSource(handler, 'large')).toEqual({ ok: false, status: 413 });
    expect(await readPreviewSource(handler, 'missing')).toEqual({ ok: false, status: 404 });
  });
});
