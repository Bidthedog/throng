import { DEFAULT_ICON_SET_NAME } from './resolve-icon.js';

/**
 * 069 FR-025 — what a new icon set may be called. A set is a folder, so its name has to be a safe single
 * path segment on every platform throng runs on, and it must not read as one of throng's own folders
 * (the default set, or a `.bak` backup of the upgrade). Pure; no OS.
 */
export type IconSetNameReason =
  | 'empty'
  | 'default'
  | 'exists'
  | 'backup'
  | 'reserved'
  | 'character'
  | 'trailing';

export type IconSetNameResult = { ok: true } | { ok: false; reason: IconSetNameReason; message: string };

const MESSAGES: Record<IconSetNameReason, string> = {
  empty: 'Give the icon set a name.',
  default: 'That name belongs to the default icon set. Choose another.',
  exists: 'An icon set with that name already exists. Names are not case sensitive.',
  backup: 'A name ending in .bak is kept for backups of icon sets from before the upgrade. Choose another.',
  reserved: 'That name is reserved by Windows for a device and cannot be used for a folder. Choose another.',
  character: 'An icon set name cannot contain any of < > : " / \\ | ? * or a control character.',
  trailing: 'An icon set name cannot end with a dot or a space.',
};

const fail = (reason: IconSetNameReason): IconSetNameResult => ({ ok: false, reason, message: MESSAGES[reason] });

/** Windows device names, which are reserved with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const BACKUP_SUFFIX = /\.bak(\.\d+)?$/i;

/** Whether a folder name is one of the upgrade's backups (`<name>.bak`, `<name>.bak.<n>`, any case), never a set (FR-037). */
export function isIconSetBackupName(name: string): boolean {
  return BACKUP_SUFFIX.test(name);
}

function hasForbiddenCharacter(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
    if ('<>:"/\\|?*'.includes(ch)) return true;
  }
  return false;
}

/** Validate `name` for a new icon set against the names of the sets already present. */
export function validateIconSetName(name: string, existing: readonly string[]): IconSetNameResult {
  if (name.trim().length === 0) return fail('empty');
  if (hasForbiddenCharacter(name)) return fail('character');
  if (/[. ]$/.test(name)) return fail('trailing');
  const folded = name.toLowerCase();
  if (folded === DEFAULT_ICON_SET_NAME.toLowerCase()) return fail('default');
  if (BACKUP_SUFFIX.test(name)) return fail('backup');
  if (WINDOWS_RESERVED.test(name)) return fail('reserved');
  if (existing.some((e) => e.toLowerCase() === folded)) return fail('exists');
  return { ok: true };
}
