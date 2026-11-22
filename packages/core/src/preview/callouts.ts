/**
 * throng's callout type registry (075, FR-018 – FR-019a, data-model "Callout type registry entry").
 *
 * The ONE source of callout types. The parser (`markdown-it-obsidian-callouts`, used as a parser only)
 * reports the type as written; this registry resolves it — case-insensitively, through its aliases — to a
 * canonical id, and that id is what a rendered callout carries. Neither the parser's own type list nor
 * Obsidian's decides anything here.
 *
 * Adding a type is one entry below plus its icon art (`icons/default-set/<icon>.svg` and the key in
 * `icon-keys.ts`): the renderer, the sanitiser and the styles read the registry and need no change.
 *
 * Pure data. No OS, no DOM.
 */
import type { IconKey } from '../icons/icon-keys.js';

/** The seven colour roles (FR-020). Each is one theme colour token, `colours.callout<Role>`. */
export const CALLOUT_ROLES = ['neutral', 'info', 'accent', 'success', 'question', 'warning', 'danger'] as const;
export type CalloutRole = (typeof CALLOUT_ROLES)[number];

export interface CalloutTypeEntry {
  readonly id: string;
  /** Lower case, unique across every entry's id and aliases. */
  readonly aliases: readonly string[];
  /** The title a marker naming this canonical id with no title text takes (FR-002). */
  readonly title: string;
  readonly icon: IconKey;
  readonly role: CalloutRole;
}

/** FR-019, in this order (the Themes editor and the docs list them so). */
export const CALLOUT_TYPES: readonly CalloutTypeEntry[] = Object.freeze([
  { id: 'note', aliases: [], title: 'Note', icon: 'calloutNote', role: 'neutral' },
  { id: 'abstract', aliases: ['summary', 'tldr'], title: 'Abstract', icon: 'calloutAbstract', role: 'info' },
  { id: 'info', aliases: [], title: 'Info', icon: 'calloutInfo', role: 'info' },
  { id: 'todo', aliases: [], title: 'Todo', icon: 'calloutTodo', role: 'info' },
  { id: 'tip', aliases: ['hint', 'important'], title: 'Tip', icon: 'calloutTip', role: 'accent' },
  { id: 'success', aliases: ['check', 'done'], title: 'Success', icon: 'calloutSuccess', role: 'success' },
  { id: 'question', aliases: ['help', 'faq'], title: 'Question', icon: 'calloutQuestion', role: 'question' },
  { id: 'warning', aliases: ['caution', 'attention', 'warn'], title: 'Warning', icon: 'calloutWarning', role: 'warning' },
  { id: 'failure', aliases: ['fail', 'missing'], title: 'Failure', icon: 'calloutFailure', role: 'danger' },
  { id: 'danger', aliases: ['error'], title: 'Danger', icon: 'calloutDanger', role: 'danger' },
  { id: 'bug', aliases: [], title: 'Bug', icon: 'calloutBug', role: 'danger' },
  { id: 'example', aliases: [], title: 'Example', icon: 'calloutExample', role: 'accent' },
  { id: 'quote', aliases: ['cite'], title: 'Quote', icon: 'calloutQuote', role: 'neutral' },
] satisfies CalloutTypeEntry[]);

/** The type an unknown marker renders as (FR-019). */
export const FALLBACK_CALLOUT_TYPE = 'note';

const BY_ID: ReadonlyMap<string, CalloutTypeEntry> = new Map(CALLOUT_TYPES.map((t) => [t.id, t]));
const BY_NAME: ReadonlyMap<string, CalloutTypeEntry> = new Map(
  CALLOUT_TYPES.flatMap((t) => [t.id, ...t.aliases].map((name) => [name, t] as const)),
);

/** Whether `value` is a canonical registry id — never an alias, never an `Object.prototype` name. */
export function isCalloutTypeId(value: string): boolean {
  return BY_ID.has(value);
}

/** The registry entry for a canonical id, or `undefined`. */
export function calloutTypeEntry(id: string): CalloutTypeEntry | undefined {
  return BY_ID.get(id);
}

/** The written type's canonical id (case-insensitive, through aliases); an unknown type is `note`, `known: false`. */
export function resolveCalloutType(written: string): { readonly id: string; readonly known: boolean } {
  const entry = BY_NAME.get(written.trim().toLowerCase());
  return entry === undefined ? { id: FALLBACK_CALLOUT_TYPE, known: false } : { id: entry.id, known: true };
}

const titleCase = (text: string): string =>
  text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

/**
 * FR-002 — the title text when the marker carries one; else, for a marker naming a canonical id, that
 * entry's default title; else the type as written, in title case (`[!tldr]` → "Tldr").
 */
export function calloutTitle(written: string, title: string | undefined): string {
  const given = (title ?? '').trim();
  if (given.length > 0) return given;
  const type = written.trim();
  const canonical = BY_ID.get(type.toLowerCase());
  return canonical !== undefined ? canonical.title : titleCase(type);
}
