/**
 * EditorRecovery — crash/close survival for open editor documents (006 Phase E,
 * FR-041/042/043; extended by 016 FR-027/FR-027a/FR-027b).
 *
 * Writes each open document's in-progress content to `%APPDATA%\throng\recovery\<panelId>`
 * continuously while it is open (independent of auto-save, and NOT a dirty signal — FR-053),
 * restores it on launch matched by panelId, and removes it on full save / editor close. Owned by UI
 * main; uses `node:fs` directly (this is a UI-main module, not core).
 *
 * ## The snapshot is STRUCTURED (016, T088)
 *
 * It used to be the document's raw text and nothing else, which left nowhere to put the undo history
 * FR-027a asks to survive a crash. It is now JSON — `{version, text, history?}` — and, crucially,
 * **the history lives inside the snapshot rather than in a file beside it**. That is a safety
 * property, not tidiness: the history holds text the user CUT or DELETED (an API key removed from a
 * config file lives on in the stack after the file is clean), so it must never outlive the snapshot.
 * One file is one lifetime — whatever removes the snapshot removes the history with it, and there is
 * no second file anyone can forget to delete (FR-027b).
 *
 * A snapshot written by an OLDER BUILD is plain text and does not parse as one of these. It is read
 * as `{text: <the raw file>}` rather than discarded — an in-flight snapshot is, by definition, work
 * the user has not saved, and losing it on upgrade would be losing exactly the thing this module
 * exists to protect.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundHistory, type SerialisedHistory } from '@throng/core';

/** Encode a panelId into a safe flat filename (panelIds are opaque tokens). */
function safeName(panelId: string): string {
  return encodeURIComponent(panelId);
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Marks a file as one of ours, and says which shape it is in.
 *
 * Without it, "does this parse as JSON?" is the test — and a document whose entire content happens
 * to be `{"text": "..."}` would be read as a snapshot of itself. Unlikely; not impossible; and the
 * failure would be silent data loss in the one component whose whole job is not losing data.
 */
const MARKER = 'throngRecovery';
const FORMAT = 1;

export interface RecoverySnapshot {
  /** The document version this snapshot was taken at. 0 for a legacy plain-text snapshot. */
  version: number;
  text: string;
  /** Absent when `editor.persistUndoHistory` is off, or when the snapshot predates 016. */
  history?: SerialisedHistory;
}

export interface RecoveredDoc extends RecoverySnapshot {
  panelId: string;
}

/**
 * Does this file even CLAIM to be one of ours? Cheap, and it decides how a parse failure is read.
 *
 * A structured snapshot always begins `{"throngRecovery":1`, so a file that starts that way and then
 * fails to parse is a TORN one of ours — not a legacy plain-text document that happens to look like
 * JSON. The distinction is the difference between skipping a corrupt file and pouring it into the
 * user's buffer as if it were their text.
 */
function claimsToBeOurs(raw: string): boolean {
  return raw.trimStart().startsWith(`{"${MARKER}":`);
}

/**
 * Read a snapshot file, tolerating the legacy plain-text form and REFUSING a torn one.
 *
 * Returns null when the file is one of ours but unreadable — which must not be confused with the
 * legacy fallback below.
 *
 * ## The failure this prevents
 *
 * The snapshot is rewritten on a 400 ms debounce on every keystroke, and the process can die
 * mid-write — which is the exact scenario this module exists for. A torn write leaves a JSON PREFIX
 * on disk:
 *
 *     {"throngRecovery":1,"version":42,"text":"import foo\nconst key = \"AK
 *
 * That does not parse. Treating any unparseable file as legacy plain text would hand that string
 * back as the document's CONTENT — the user reopens their file and finds a buffer full of escaped
 * JSON, marked dirty, and the next Ctrl+S writes it over their source. The old plain-text format
 * could only ever lose the TAIL of a torn write; the structured format turns the same truncation
 * into corruption, so it has to be recognised and refused.
 */
function parseSnapshot(raw: string): RecoverySnapshot | null {
  if (claimsToBeOurs(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null; // …torn. Better no recovery than a corrupt one.
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const snap = parsed as Record<string, unknown>;
    // No text field is not "an empty document" — it is a file we cannot read. Returning '' here
    // would blank the user's buffer and mark it dirty.
    if (snap[MARKER] !== FORMAT || typeof snap.text !== 'string') return null;

    return {
      version: typeof snap.version === 'number' ? snap.version : 0,
      text: snap.text,
      history: (snap.history as SerialisedHistory | undefined) ?? undefined,
    };
  }

  // Not ours, and never claimed to be: a plain-text snapshot from before 016. An in-flight snapshot
  // is by definition work the user has not saved, so it is READ, not discarded.
  return { version: 0, text: raw };
}

export class EditorRecovery {
  constructor(private readonly dir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /**
   * Write (overwrite) the recovery temp for a panel's current content and history.
   *
   * The history is bounded HERE rather than by the caller, so the cap cannot be honoured on one code
   * path and forgotten on another — this is the only place a history reaches the disk.
   */
  async write(panelId: string, snapshot: RecoverySnapshot): Promise<void> {
    await this.ensureDir();
    const payload = {
      [MARKER]: FORMAT,
      version: snapshot.version,
      text: snapshot.text,
      ...(snapshot.history ? { history: boundHistory(snapshot.history) } : {}),
    };

    // ATOMIC: written to a temp file, then RENAMED over the real one.
    //
    // A crash-recovery file that can itself be destroyed by a crash is not much of a recovery file.
    // These writes land on a 400 ms debounce while the user types, so "the process died mid-write"
    // is not an exotic case here — it is the case the whole module exists for. `rename` within one
    // directory is atomic on both NTFS and POSIX, so the reader sees either the previous snapshot or
    // the new one, and never half of either.
    const target = join(this.dir, safeName(panelId));
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(payload), 'utf8');
    await rename(temp, target);
  }

  /** Remove a panel's recovery temp — content AND history, in one act (full save / close). */
  async remove(panelId: string): Promise<void> {
    await rm(join(this.dir, safeName(panelId)), { force: true });
  }

  /**
   * Strip the persisted history from every snapshot on disk, keeping the content (FR-027c).
   *
   * What `editor.persistUndoHistory: false` does the moment it is turned off. Waiting for the next
   * keystroke to overwrite the snapshot would leave the user's deleted text on disk for as long as
   * they left the document alone — which, for someone who has just turned the setting off because
   * they cut a secret into it, is precisely the wrong moment to be lazy.
   */
  async purgeHistories(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.endsWith('.tmp')) continue;
      try {
        const snap = parseSnapshot(await readFile(join(this.dir, name), 'utf8'));
        if (!snap?.history) continue;
        await this.write(decodeName(name), { version: snap.version, text: snap.text });
      } catch {
        /* skip unreadable temp */
      }
    }
  }

  /** All recovery temps currently on disk (launch-time reconciliation). */
  async list(): Promise<RecoveredDoc[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: RecoveredDoc[] = [];
    for (const name of names) {
      // A `.tmp` is a write that never completed its rename. It is not a snapshot, and its panelId
      // would decode to nonsense — skip it rather than offering it to a panel.
      if (name.endsWith('.tmp')) continue;
      try {
        const snap = parseSnapshot(await readFile(join(this.dir, name), 'utf8'));
        if (snap) out.push({ panelId: decodeName(name), ...snap });
      } catch {
        /* skip unreadable temp */
      }
    }
    return out;
  }

  /** Read one panel's recovery snapshot — null if absent, or if it is one of ours but torn. */
  async read(panelId: string): Promise<RecoverySnapshot | null> {
    try {
      return parseSnapshot(await readFile(join(this.dir, safeName(panelId)), 'utf8'));
    } catch {
      return null;
    }
  }
}
