import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideRendererRequest } from '@throng/core';
import { closeOnEscape, decidePagesRequest, installPagesRequestFilter } from '../../src/main/print-pages-session.js';

/**
 * 075 FR-068, FR-079 — the session Print Preview's pages view loads its PDFs in.
 *
 * The pages are a PDF main writes under the job folder in the user-data directory. In the default session,
 * Layer 4 (044, `renderer-request-filter.ts`) allows a `file:` URL only beneath the renderer's own directory, so
 * a pages view in that session had every PDF load cancelled and Print Preview never showed a page. The view has
 * a session of its own whose filter admits exactly the job folder's files and refuses every network request.
 */
const jobsDir = join('/', 'data', 'throng', 'print-jobs');
const pdf = pathToFileURL(join(jobsDir, 'job-1', 'pages-1.pdf')).href;

describe('the pages view session', () => {
  it('is needed: the default session refuses a job PDF', () => {
    expect(decideRendererRequest({ url: pdf, resourceType: 'mainFrame' }, { rendererDir: join('/', 'app', 'renderer'), remoteImages: false })).toBe('cancel');
  });

  it('admits a PDF under the job folder', () => {
    expect(decidePagesRequest(pdf, jobsDir)).toBe(true);
  });

  it('refuses a file outside the job folder, including by climbing out of it', () => {
    expect(decidePagesRequest(pathToFileURL(join('/', 'data', 'throng', 'secret.pdf')).href, jobsDir)).toBe(false);
    expect(decidePagesRequest(`${pathToFileURL(jobsDir).href}/%2e%2e/secret.pdf`, jobsDir)).toBe(false);
  });

  it('refuses every network request', () => {
    for (const url of ['https://example.com/x.png', 'http://example.com/', 'ws://example.com/', 'wss://example.com/', 'ftp://example.com/x']) {
      expect(decidePagesRequest(url, jobsDir)).toBe(false);
    }
  });

  it("lets Chromium's PDF viewer load its own parts", () => {
    expect(decidePagesRequest('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', jobsDir)).toBe(true);
    expect(decidePagesRequest('blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/0d1c', jobsDir)).toBe(true);
  });

  it('refuses a malformed URL', () => {
    expect(decidePagesRequest('not a url', jobsDir)).toBe(false);
  });

  it('closes Print Preview on Escape pressed in the pages (FR-071)', () => {
    type Listener = (event: { preventDefault(): void }, input: { type: string; key: string }) => void;
    let listener: Listener | undefined;
    let closed = 0;
    closeOnEscape({ on: (_e: 'before-input-event', l: Listener) => (listener = l) }, () => (closed += 1));
    const prevented: boolean[] = [];
    const press = (type: string, key: string): void => {
      let p = false;
      listener?.({ preventDefault: () => (p = true) }, { type, key });
      prevented.push(p);
    };
    press('keyDown', 'a');
    press('keyUp', 'Escape');
    expect(closed).toBe(0);
    press('keyDown', 'Escape');
    expect(closed).toBe(1);
    expect(prevented).toEqual([false, false, true]);
  });

  it('installs the decision on the session', () => {
    type Listener = (d: { url: string }, cb: (r: { cancel?: boolean }) => void) => void;
    let listener: Listener | undefined;
    const session = {
      webRequest: {
        onBeforeRequest: (_filter: unknown, l: Listener) => {
          listener = l;
        },
      },
    };
    installPagesRequestFilter(session as never, jobsDir);
    const cancelled = (url: string): boolean | undefined => {
      let cancel: boolean | undefined;
      listener?.({ url }, (r) => {
        cancel = r.cancel;
      });
      return cancel;
    };
    expect(cancelled(pdf)).toBe(false);
    expect(cancelled('https://example.com/')).toBe(true);
  });
});
