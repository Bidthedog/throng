/**
 * The render sanitiser's callout rule (075, FR-014, contracts/callout-markup.md §Sanitiser).
 *
 * The profile admits the callout attributes so DOMPurify does not drop them; this rule, run from the
 * sanitiser's `afterSanitizeAttributes` hook, decides where they may stay:
 *
 * 1. `data-callout` only on a `div` the pipeline emitted (this render's nonce) AND naming a registry id. A raw
 *    `<div data-callout="warning">` in the document, or a forged value, loses every callout attribute.
 *    `data-callout-role` stays only where it is that id's registry role.
 * 2. `data-callout-fold` only beside a surviving `data-callout`, and only as `open` or `closed`.
 * 3. The presence attributes (title, title text, icon, body) only on a `div`/`span` inside a surviving callout,
 *    and only empty. DOMPurify walks in document order, so the ancestor has already been through rule 1.
 *
 * Nothing here admits a class, a style, an event handler or a URL: the callout's look is throng's stylesheet,
 * selected by these attributes, and nothing else.
 */
import { calloutTypeEntry } from '@throng/core';
import {
  CALLOUT_ATTRIBUTE,
  CALLOUT_BODY_ATTRIBUTE,
  CALLOUT_FOLD_ATTRIBUTE,
  CALLOUT_ICON_ATTRIBUTE,
  CALLOUT_ROLE_ATTRIBUTE,
  CALLOUT_TITLE_ATTRIBUTE,
  CALLOUT_TITLE_TEXT_ATTRIBUTE,
} from './callout-markup.js';

const PRESENCE = [CALLOUT_TITLE_ATTRIBUTE, CALLOUT_TITLE_TEXT_ATTRIBUTE, CALLOUT_ICON_ATTRIBUTE, CALLOUT_BODY_ATTRIBUTE] as const;

/** Every attribute the profile admits for callouts. */
export const CALLOUT_ATTRIBUTES: readonly string[] = [CALLOUT_ATTRIBUTE, CALLOUT_ROLE_ATTRIBUTE, CALLOUT_FOLD_ATTRIBUTE, ...PRESENCE];

const FOLD_VALUES = new Set(['open', 'closed']);

/** Apply the three rules to `node`; `fromPipeline` is whether it carries this render's nonce. */
export function sanitiseCalloutAttributes(node: Element, fromPipeline: boolean): void {
  const tag = node.tagName.toUpperCase();
  const type = node.getAttribute(CALLOUT_ATTRIBUTE);
  if (type !== null) {
    const entry = calloutTypeEntry(type);
    if (!fromPipeline || tag !== 'DIV' || entry === undefined || node.getAttribute(CALLOUT_ROLE_ATTRIBUTE) !== entry.role) {
      node.removeAttribute(CALLOUT_ATTRIBUTE);
      node.removeAttribute(CALLOUT_ROLE_ATTRIBUTE);
      node.removeAttribute(CALLOUT_FOLD_ATTRIBUTE);
    } else {
      const fold = node.getAttribute(CALLOUT_FOLD_ATTRIBUTE);
      if (fold !== null && !FOLD_VALUES.has(fold)) node.removeAttribute(CALLOUT_FOLD_ATTRIBUTE);
    }
  } else {
    node.removeAttribute(CALLOUT_ROLE_ATTRIBUTE);
    node.removeAttribute(CALLOUT_FOLD_ATTRIBUTE);
  }

  const present = PRESENCE.filter((name) => node.hasAttribute(name));
  if (present.length === 0) return;
  const inCallout = node.parentElement?.closest(`[${CALLOUT_ATTRIBUTE}]`) !== null && node.parentElement !== null;
  const allowedTag = tag === 'DIV' || tag === 'SPAN';
  for (const name of present) {
    if (!inCallout || !allowedTag || node.getAttribute(name) !== '') node.removeAttribute(name);
  }
}
