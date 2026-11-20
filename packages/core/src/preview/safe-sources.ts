/**
 * 074 FR-072a — **Safe HTML preview sources**: the remote origins an HTML Preview may load stylesheets, fonts and images
 * from. A source is an `https:` origin (`https://fonts.gstatic.com`, `https://cdn.example.com:8443`), or a wildcard over
 * a domain's subdomains (`https://*.example.com`, which does not admit `example.com` itself). `http:` is never a source:
 * a page fetched in the clear could be anything by the time it arrives.
 *
 * Pure: the global preference (`editor.previews.providers.html.safeSources`) and the project's list (Project Settings)
 * are both read through {@link safeSourceList}, and every layer that enforces the list — the sanitiser, the frame's
 * content policy, the request filter — asks {@link matchesSafeSource}.
 */
import { logExpected } from '../diagnostics/caught.js';

/** FR-072a — what ships: Google Fonts' stylesheet and font hosts. */
export const SHIPPED_HTML_SAFE_SOURCES: readonly string[] = Object.freeze([
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]);

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function validHost(host: string): boolean {
  return host.length > 0 && host.split('.').every((label) => HOST_LABEL.test(label));
}

/**
 * One source as typed — with or without `https://`, any case, any path or query — in canonical form, or `null` when
 * it is not one: another scheme, no host, or a wildcard anywhere but a leading `*.` label.
 */
export function normaliseSafeSource(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/.exec(text);
  if (schemeMatch !== null && schemeMatch[1] !== 'https' && !/^[^/]+:\d/.test(text)) return null;
  const rest = schemeMatch?.[1] === 'https' ? text.slice('https:'.length).replace(/^\/\//, '') : text;
  const authority = rest.split(/[/?#]/, 1)[0] ?? '';
  const [hostPart, port, ...extra] = authority.split(':');
  if (extra.length > 0 || hostPart === undefined) return null;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null;
  const wildcard = hostPart.startsWith('*.');
  const host = wildcard ? hostPart.slice(2) : hostPart;
  if (!validHost(host) || (wildcard && !host.includes('.') && host.length === 0)) return null;
  // 443 is https's default: a URL on it has no port, so the source must not name one either (FR-072c).
  const shown = port !== undefined && Number(port) !== 443 ? `:${Number(port)}` : '';
  return `https://${wildcard ? '*.' : ''}${host}${shown}`;
}

/**
 * 074 FR-072c — what is wrong with `raw` as a source, in the user's words, or `null` when it is one. Every editor that
 * adds a source refuses an entry this rejects and shows this message.
 */
export function safeSourceFault(raw: string): string | null {
  if (normaliseSafeSource(raw) !== null) return null;
  if (raw.trim() === '') return 'Enter a web address, like https://cdn.example.com';
  return /^\s*[a-z][a-z0-9+.-]*:/i.test(raw) && !/^\s*https:/i.test(raw) && !/^\s*[^/\s:]+:\d/.test(raw)
    ? 'Only https addresses can be sources'
    : `Not a web address: ${raw.trim()} — use one like https://cdn.example.com, or https://*.example.com for every subdomain`;
}

/** A stored list, normalised: entries that are not sources dropped, duplicates removed, order kept. */
export function safeSourceList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const source = normaliseSafeSource(entry);
    if (source !== null && !out.includes(source)) out.push(source);
  }
  return out;
}

/**
 * The origin a URL would need listed — `https://cdn.example.com` — or `null` for something that is not a URL with a
 * host. Protocol-relative `//host/…` reads as `https:`, which is what the page would ask for. Used to group what a
 * page could not load under the source that would allow it (FR-093a).
 */
export function sourceOf(url: string): string | null {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  try {
    const parsed = new URL(absolute);
    if (parsed.host === '') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    logExpected('safe-sources: the source of a URL', 'a page may name a resource by a malformed URL; it has no source', error);
    return null;
  }
}

/** Whether `url` is an `https:` URL whose origin one of `sources` (canonical, from {@link safeSourceList}) admits. */
export function matchesSafeSource(url: string, sources: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    logExpected('safe-sources: match a URL', 'a page may name a resource by a malformed URL; no source admits it', error);
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  const port = parsed.port;
  for (const source of sources) {
    const m = /^https:\/\/(\*\.)?([^:/]+)(?::(\d+))?$/.exec(source);
    if (m === null) continue;
    if ((m[3] ?? '') !== port) continue;
    const domain = m[2] ?? '';
    if (m[1] !== undefined ? host.endsWith(`.${domain}`) : host === domain) return true;
  }
  return false;
}
