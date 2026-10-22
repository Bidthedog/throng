/**
 * Who is using this copy? (058 research D9, data-model `InstallInUse`.)
 *
 * Before an installer replaces or removes a copy of throng it asks which accounts have processes
 * running from that copy's install root. The OS query belongs to the helper script
 * (`packaging/in-use.mjs`); this is the pure half that splits what it found.
 *
 * NO IMPORTS, deliberately: the built file of this module is shipped on its own, beside the helper
 * (`resources/in-use/in-use-classify.js`, and embedded in the setup), so that it runs against an
 * install root of ANY earlier version where `@throng/core` cannot be resolved. Keep it that way.
 */

/** One running process, as the helper reads it from the OS. */
export interface InUseProcess {
  pid: number;
  /** Full path of the process's executable; empty when the OS would not say. */
  executablePath: string;
  /** SID of the account that owns the process; empty when it could not be read. */
  ownerSid: string;
  /** `DOMAIN\user` of the owner, for the message; empty when it could not be read. */
  ownerName: string;
}

/** The accounts other than the performing one that are using the install root. */
export interface InUseOtherAccount {
  account: string;
  pids: number[];
}

export type InUseDecision = 'free' | 'own-only' | 'others';

export interface InstallInUse {
  /** Pids of the performing account's processes from this install root. */
  own: number[];
  /** Other accounts using this install root, one entry each, ordered by account name. */
  others: InUseOtherAccount[];
  /** Drives the installer's branch: nothing to do, the 020 FR-019 handoff, or FR-016a. */
  decision: InUseDecision;
  /** The interactive refusal text naming each account; `null` unless `decision` is `'others'`. */
  message: string | null;
}

/** Lower-cased, forward slashes to back, trailing separators dropped: how two paths are compared. */
function normalisePath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function isUnder(executablePath: string, root: string): boolean {
  if (executablePath === '' || root === '') return false;
  const path = normalisePath(executablePath);
  return path.startsWith(root + '\\');
}

/** What an account with no readable owner is called in the message. */
const UNKNOWN_ACCOUNT = 'an account that could not be identified';

export function classifyInstallUse(
  processes: readonly InUseProcess[],
  installRoot: string,
  performingSid: string,
): InstallInUse {
  const root = normalisePath(installRoot);
  const me = performingSid.toLowerCase();
  const own: number[] = [];
  // Keyed by SID where there is one, so two spellings of one account are one entry.
  const byAccount = new Map<string, InUseOtherAccount>();

  for (const p of processes) {
    // A process under a different copy's root is not this copy's business (FR-017).
    if (!isUnder(p.executablePath, root)) continue;
    const sid = p.ownerSid.toLowerCase();
    if (sid !== '' && sid === me) {
      own.push(p.pid);
      continue;
    }
    const account = p.ownerName !== '' ? p.ownerName : p.ownerSid !== '' ? p.ownerSid : UNKNOWN_ACCOUNT;
    const key = sid !== '' ? sid : account.toLowerCase();
    const entry = byAccount.get(key);
    if (entry) entry.pids.push(p.pid);
    else byAccount.set(key, { account, pids: [p.pid] });
  }

  const others = [...byAccount.values()].sort((a, b) => a.account.toLowerCase().localeCompare(b.account.toLowerCase()));
  const decision: InUseDecision = others.length > 0 ? 'others' : own.length > 0 ? 'own-only' : 'free';
  const message =
    decision === 'others'
      ? 'throng is in use by other people signed in to this computer: ' +
        others.map((o) => o.account).join(', ') +
        '. Nothing has been changed. Ask them to close throng, then try again.'
      : null;
  return { own, others, decision, message };
}
