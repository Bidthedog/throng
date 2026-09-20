import {
  knownFileExtensionsSet,
  protocolAllowlistSet,
  type EditorLinkSettings,
  type ScanOptions,
} from '@throng/core';
import { refusedSchemes } from './refused-schemes-client.js';

/**
 * 045 FR-159, FR-178, FR-178a — what the user's link settings contribute to `scanLinkLine`, for every
 * surface that scans (data-model §16.11's `ScanOptions`).
 *
 * The settings store the two lists AS TYPED — the allowlist, and (since round five's FR-178b) the one
 * extension list the user edits; a scan needs SETS. This is the one place the renderer turns the first
 * into the second, so an editor and a terminal reading the same settings cannot scan differently
 * (FR-104). `refused` is the window's refused set
 * (`refused-schemes-client.ts`): core's OS-neutral half until main answers, then the union (T288).
 *
 * Read per scan from the live settings, never captured at mount, so an edit lands on the next pass with
 * nothing remounted (FR-159, FR-178). The last answer is kept, keyed by the values, because every
 * visible line of every panel asks between two settings changes.
 */
type LinkScanSettings = Pick<EditorLinkSettings, 'protocolAllowlist' | 'knownFileExtensions'>;

let last: {
  readonly key: string;
  readonly refused: ReadonlySet<string>;
  readonly options: ScanOptions;
} | null = null;

/** A value key for the settings a scan reads — equal whenever the scan would be. */
export function linkScanKey(links: LinkScanSettings): string {
  return JSON.stringify([links.protocolAllowlist, links.knownFileExtensions]);
}

export function linkScanOptions(links: LinkScanSettings): ScanOptions {
  const key = linkScanKey(links);
  // T288: the refused set is core's half until main answers, then the union — a new set, so the memo
  // is rebuilt the first scan after it lands.
  const refused = refusedSchemes();
  if (last !== null && last.key === key && last.refused === refused) return last.options;
  const options: ScanOptions = {
    knownExtensions: knownFileExtensionsSet(links.knownFileExtensions),
    allowlist: protocolAllowlistSet(links.protocolAllowlist),
    refused,
  };
  last = { key, refused, options };
  return options;
}
