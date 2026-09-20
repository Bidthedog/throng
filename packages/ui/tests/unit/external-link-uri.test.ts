import { describe, expect, it } from 'vitest';
import {
  CORE_REFUSED_URI_SCHEMES,
  type IForegroundHandoff,
  type IRefusedUriSchemes,
  type IShellIntegration,
} from '@throng/core';

import { isAllowedLinkUri, registerLinkUriIpc } from '../../src/main/external-url.js';

/**
 * 045 T257 (FR-156, FR-157, FR-159, FR-037; plan round four strand 2, twelfth and thirteenth passes) —
 * the policy on `throng:linkUri:openExternal`, the ONE channel a web, loopback or allowlisted protocol
 * link leaves the app by.
 *
 * `isAllowedLinkUri(url, allowlist, refused)` accepts `http(s)` (web and loopback) and a scheme on the
 * allowlist; refuses every refused scheme even when allowlisted (refused wins, FR-159); refuses `file:`
 * ALWAYS — a `file:` URI never reaches the OS URL opener (FR-037) — and re-sanitises, because the
 * renderer is not trusted to have done it (FR-156).
 *
 * The existing `throng:openExternal` and `throng:preview:openExternal` policies are untouched, and so is
 * their test (`external-url.test.ts`).
 */

const ALLOW: ReadonlySet<string> = new Set(['mailto', 'tel', 'slack']);
const PLATFORM: ReadonlySet<string> = new Set(['ms-msdt', 'search-ms']);
const REFUSED: ReadonlySet<string> = new Set([...CORE_REFUSED_URI_SCHEMES, ...PLATFORM]);

describe('isAllowedLinkUri — what may leave by throng:linkUri:openExternal', () => {
  it('accepts web and loopback addresses', () => {
    expect(isAllowedLinkUri('https://example.com/a', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('HTTP://Example.com/', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('http://localhost:5173/', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('http://127.0.0.1:8080/x', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('http://[::1]:3000/', ALLOW, REFUSED)).toBe(true);
  });

  it('accepts an allowlisted scheme, and only while it is allowlisted', () => {
    expect(isAllowedLinkUri('mailto:a@b.c', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('tel:+441234', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('slack://open', ALLOW, REFUSED)).toBe(true);
    expect(isAllowedLinkUri('mailto:a@b.c', new Set(), REFUSED)).toBe(false);
    expect(isAllowedLinkUri('zoommtg://x', ALLOW, REFUSED)).toBe(false);
  });

  it('refuses every refused scheme even when allowlisted (FR-159)', () => {
    for (const scheme of REFUSED) {
      const allow = new Set([...ALLOW, scheme]);
      expect(isAllowedLinkUri(`${scheme}:x`, allow, REFUSED), scheme).toBe(false);
      expect(isAllowedLinkUri(`${scheme}://x`, allow, REFUSED), scheme).toBe(false);
    }
  });

  it('refuses file: always, even allowlisted (FR-037)', () => {
    expect(isAllowedLinkUri('file:///C:/Windows/System32/calc.exe', ALLOW, REFUSED)).toBe(false);
    expect(isAllowedLinkUri('FILE:///C:/x.txt', new Set([...ALLOW, 'file']), REFUSED)).toBe(false);
    expect(isAllowedLinkUri('file://fileserver/home/x', new Set(['file']), new Set())).toBe(false);
  });

  it('re-sanitises: a NUL or a control character is refused (FR-156)', () => {
    expect(isAllowedLinkUri('https://example.com/a%00b', ALLOW, REFUSED)).toBe(false);
    expect(isAllowedLinkUri(`https://example.com/a${String.fromCharCode(0)}`, ALLOW, REFUSED)).toBe(false);
    expect(isAllowedLinkUri(`mailto:a@b.c${String.fromCharCode(0x0a)}x`, ALLOW, REFUSED)).toBe(false);
  });

  it('refuses anything that is not a string, and a path', () => {
    for (const bad of [undefined, null, 42, { href: 'https://x' }, '', 'C:\\x.txt', '\\\\fileserver\\home\\x']) {
      expect(isAllowedLinkUri(bad, ALLOW, REFUSED), JSON.stringify(bad)).toBe(false);
    }
  });
});

function wiring(allowlist: string[], platform: ReadonlySet<string> = PLATFORM) {
  const listeners = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const handles = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const opened: string[] = [];
  const order: string[] = [];
  const shell = {
    revealInFileManager: async () => {},
    openFolder: async () => {},
    openWithDefaultProgram: async () => {},
    openExternal: async (url: string) => {
      opened.push(url);
      order.push(`open:${url}`);
    },
  } as unknown as IShellIntegration;
  const handoff: IForegroundHandoff = {
    allow: () => {
      order.push('allow');
      return true;
    },
  };
  const refused: IRefusedUriSchemes = { refusedSchemes: () => platform };
  registerLinkUriIpc(
    {
      on: (channel, listener) => void listeners.set(channel, listener),
      handle: (channel, listener) => void handles.set(channel, listener),
    },
    refused,
    () => allowlist,
    shell,
    handoff,
  );
  return {
    opened,
    order,
    handles,
    send: (url: unknown) => {
      const listener = listeners.get('throng:linkUri:openExternal');
      if (!listener) throw new Error('nothing registered on throng:linkUri:openExternal');
      listener({}, url);
    },
  };
}

describe('T287 / T288 — throng:linkUri:refusedSchemes answers the platform’s half (research R34)', () => {
  it('is an invoke handler answering the port’s schemes as a list', async () => {
    const { handles } = wiring([], new Set(['ms-msdt', 'search-ms']));
    const handler = handles.get('throng:linkUri:refusedSchemes');
    expect(handler, 'registered by registerLinkUriIpc').toBeDefined();
    const answer = (await handler!({}, undefined)) as string[];
    expect([...answer].sort()).toEqual(['ms-msdt', 'search-ms']);
  });
});

describe('throng:linkUri:openExternal — the handler', () => {
  it('opens web, loopback and allowlisted links, handing the foreground on first', () => {
    const { send, opened, order } = wiring(['mailto']);
    send('https://example.com/');
    send('mailto:a@b.c');
    expect(opened).toEqual(['https://example.com/', 'mailto:a@b.c']);
    expect(order).toEqual(['allow', 'open:https://example.com/', 'allow', 'open:mailto:a@b.c']);
  });

  it('reads the allowlist PER REQUEST, so a change applies to the next gesture (FR-159)', () => {
    const allowlist: string[] = [];
    const { send, opened } = wiring(allowlist);
    send('mailto:a@b.c');
    expect(opened).toEqual([]);
    allowlist.push(' Mailto: ');
    send('mailto:a@b.c');
    expect(opened).toEqual(['mailto:a@b.c']);
  });

  it('applies the PLATFORM\u2019s refused set, even to an allowlisted scheme', () => {
    const { send, opened, order } = wiring(['ms-msdt', 'javascript']);
    send('ms-msdt:/id PCWDiagnostic');
    send('javascript:alert(1)');
    expect(opened).toEqual([]);
    expect(order, 'a refused URI buys no foreground').toEqual([]);
  });

  it('never opens file:, and opens a crafted URI only as its one sanitised value', () => {
    const { send, opened } = wiring(['file']);
    send('file:///C:/Windows/System32/calc.exe');
    send('https://x" --foo');
    expect(opened).toEqual(['https://x/']);
  });
});
