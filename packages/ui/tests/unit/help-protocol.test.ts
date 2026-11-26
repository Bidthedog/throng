/**
 * 080 FR-049, FR-050, FR-052 — the read-only `throng-help:` scheme the Help window loads the shipped guide through.
 * It serves files below the bundle and nothing else (by spelling and by real path), with a type, a content
 * security policy that allows nothing remote, and — when the bundle is missing — a page saying so, logged once.
 *
 * Layer: unit — the handler is `(Request) => Promise<Response>` over a real temp folder; no Electron.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HELP_CSP, createHelpProtocolHandler } from '../../src/main/help-protocol.js';

let base: string;
let root: string;
let logged: string[];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'throng-help-proto-'));
  root = join(base, 'help');
  mkdirSync(join(root, 'guide', 'terminals'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'guide', 'index.html'), '<h1>Intro</h1>');
  writeFileSync(join(root, 'guide', 'terminals', 'index.html'), '<h1>Terminals</h1>');
  writeFileSync(join(root, 'assets', 'site.css'), 'body{}');
  writeFileSync(join(base, 'secret.txt'), 'secret');
  logged = [];
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const handler = (r = root, websiteRoot?: string) =>
  createHelpProtocolHandler({ root: r, log: (line: string) => logged.push(line), ...(websiteRoot ? { websiteRoot } : {}) });
const get = (url: string, r?: string) => handler(r)(new Request(url));

describe('throng-help: (FR-049, FR-050)', () => {
  it("serves a directory's index.html, typed, with the content security policy", async () => {
    const res = await get('throng-help://app/guide/terminals/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-security-policy')).toBe(HELP_CSP);
    expect(await res.text()).toBe('<h1>Terminals</h1>');
  });

  it('points a page\'s website links at the build\'s website (FR-065)', async () => {
    writeFileSync(join(root, 'guide', 'index.html'), '<link rel="canonical" href="https://throng-ide.com/guide/"><a href="https://throng-ide.com/#install">');
    const dev = await (await handler(root, 'http://localhost:8080/')(new Request('throng-help://app/guide/'))).text();
    expect(dev).toBe('<link rel="canonical" href="http://localhost:8080/guide/"><a href="http://localhost:8080/#install">');
    const live = await (await get('throng-help://app/guide/')).text();
    expect(live).toContain('https://throng-ide.com/guide/');
  });

  it('serves assets by their type', async () => {
    const res = await get('throng-help://app/assets/site.css');
    expect(res.headers.get('content-type')).toMatch(/^text\/css/);
  });

  it('allows nothing remote', () => {
    expect(HELP_CSP).toContain("default-src 'self'");
    expect(HELP_CSP).not.toMatch(/https?:|\*/);
  });

  it.each(['throng-help://app/../secret.txt', 'throng-help://app/%2e%2e/secret.txt', 'throng-help://app/guide/%2e%2e/%2e%2e/secret.txt'])(
    'refuses a path outside the bundle: %s',
    async (url) => {
      const res = await get(url);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('secret');
    },
  );

  it('refuses a link inside the bundle that leads outside it', async () => {
    symlinkSync(join(base, 'secret.txt'), join(root, 'assets', 'leak.txt'));
    const res = await get('throng-help://app/assets/leak.txt');
    expect(res.status).toBe(404);
  });

  it('answers 404 for a missing file and any other host', async () => {
    expect((await get('throng-help://app/guide/nope/')).status).toBe(404);
    expect((await get('throng-help://elsewhere/guide/')).status).toBe(404);
  });
});

describe('a copy built without the guide (FR-052)', () => {
  it('shows a page saying so and how to build it, and logs it once', async () => {
    const missing = handler(join(base, 'absent'));
    const first = await missing(new Request('throng-help://app/guide/'));
    await missing(new Request('throng-help://app/guide/terminals/'));
    expect(first.headers.get('content-type')).toMatch(/^text\/html/);
    expect(first.headers.get('content-security-policy')).toBe(HELP_CSP);
    const body = await first.text();
    expect(body).toContain('npm run build');
    expect(body).toContain(join(base, 'absent'));
    expect(logged).toHaveLength(1);
  });
});
