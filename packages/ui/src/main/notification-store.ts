import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  addEntry,
  applyLimit,
  dismissAllEntries,
  dismissEntry,
  dismissLimitWarning,
  emptyNotificationsDocument,
  followLimitWarning,
  limitWarningActive,
  logCaught,
  logExpected,
  parseNotificationsDocument,
  pendingSummary,
  rearm,
  setOrder,
  type EntrySeverity,
  type NotificationEntry,
  type NotificationEntryInput,
  type NotificationOrder,
  type NotificationsDocument,
} from '@throng/core';

const READ_ATTEMPTS = 3;
const READ_RETRY_MS = 50;

/** What every window renders (contracts/ipc.md "Main ↔ renderer: notifications"). */
export interface NotificationsSnapshot {
  entries: NotificationEntry[];
  order: NotificationOrder;
  pendingCount: number;
  pendingSeverity: EntrySeverity | null;
  limit: number;
  /** The limit warning is outstanding: shown, and neither dismissed nor followed (FR-031f). */
  limitWarningActive: boolean;
}

export interface NotificationStoreDeps {
  /** The panel limit now in force (`notifications.panelLimit`). */
  limit: () => number;
  /** Test seam: how the file is read. Defaults to `fs.readFile`. */
  readFile?: (path: string) => Promise<string>;
  /** Test seam: the pause between retries of a locked file. */
  retryDelayMs?: number;
  /** A line for the diagnostics log: a dropped entry, a file set aside (FR-031c, FR-031e). */
  log: (message: string) => void;
  /** After every change: main broadcasts the snapshot to every window. */
  changed: (snapshot: NotificationsSnapshot) => void;
  /** A repeat of a stored condition: the main window flashes the entry (FR-029, FR-031b). */
  repeat: (id: string) => void;
  /** The limit was reached and the warning is still owed (FR-031f). */
  limitReached: () => void;
  newId?: () => string;
  now?: () => number;
}

/**
 * The Notifications panel's entries, held by main in `userData/notifications.json` (068 FR-031),
 * modelled on `FormHistoryService`: one queue so each call reads what the one before wrote, and an
 * atomic temp-file-and-rename write. Every rule is `@throng/core`'s `notification-entries.ts`; this
 * class only loads, persists and announces.
 *
 * A file that cannot be read as a version-1 document is renamed `notifications.json.bad`, logged, and
 * the store starts empty (FR-031c) — losing the panel's history is a smaller harm than a window that
 * cannot start, and the original is kept for anyone who wants it.
 */
export class NotificationStore {
  private doc: NotificationsDocument | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly deps: NotificationStoreDeps,
  ) {}

  list(): Promise<NotificationsSnapshot> {
    return this.enqueue(async () => this.snapshot(await this.load()));
  }

  add(input: NotificationEntryInput): Promise<{ outcome: 'added' | 'repeat'; id: string }> {
    return this.enqueue(async () => {
      const doc = await this.load();
      const result = addEntry(doc, input, {
        id: (this.deps.newId ?? randomUUID)(),
        now: (this.deps.now ?? Date.now)(),
        limit: this.deps.limit(),
      });
      for (const dropped of result.dropped) this.logDrop(dropped);
      await this.commit(result.doc);
      if (result.outcome === 'repeat') this.deps.repeat(result.id);
      if (result.limitReached) this.deps.limitReached();
      return { outcome: result.outcome, id: result.id };
    });
  }

  dismiss(id: string): Promise<void> {
    return this.mutate((doc) => dismissEntry(doc, id, this.deps.limit()));
  }

  dismissAll(): Promise<void> {
    return this.mutate((doc) => dismissAllEntries(doc));
  }

  setOrder(order: NotificationOrder): Promise<void> {
    return this.mutate((doc) => setOrder(doc, order));
  }

  dismissLimitWarning(): Promise<void> {
    return this.mutate((doc) => dismissLimitWarning(doc));
  }

  /** The link was followed: the card closes and the warning arms again (FR-031g). */
  followLimitWarning(): Promise<void> {
    return this.mutate((doc) => followLimitWarning(doc));
  }

  /** The limit was lowered: drop the oldest down to it, logging each (FR-031e). */
  applyLimit(): Promise<void> {
    return this.enqueue(async () => {
      const limit = this.deps.limit();
      const loaded = await this.load();
      const { doc: trimmed, dropped } = applyLimit(loaded, limit);
      // A raised limit may leave the count below it again: the warning arms for the new one (FR-031g).
      const doc = rearm(trimmed, limit);
      if (dropped.length === 0 && doc === loaded) return;
      for (const entry of dropped) this.logDrop(entry);
      await this.commit(doc);
    });
  }

  private logDrop(entry: NotificationEntry): void {
    // No message, title or subject: those can carry names and paths, and the log is anonymised by
    // what it is given (FR-034a). The severity and age identify the entry well enough.
    this.deps.log(`notifications: dropped the oldest entry past the limit severity=${entry.severity} raisedAt=${entry.raisedAt}`);
  }

  private mutate(change: (doc: NotificationsDocument) => NotificationsDocument): Promise<void> {
    return this.enqueue(async () => {
      const doc = await this.load();
      const next = change(doc);
      if (next === doc) return;
      await this.commit(next);
    });
  }

  private snapshot(doc: NotificationsDocument): NotificationsSnapshot {
    const pending = pendingSummary(doc.entries);
    return {
      entries: doc.entries,
      order: doc.order,
      pendingCount: pending.count,
      pendingSeverity: pending.severity,
      limit: this.deps.limit(),
      limitWarningActive: limitWarningActive(doc),
    };
  }

  private async commit(doc: NotificationsDocument): Promise<void> {
    this.doc = doc;
    await this.save(doc);
    this.deps.changed(this.snapshot(doc));
  }

  /** One at a time, in arrival order: each call reads what the one before it wrote. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.catch((error: unknown) => logCaught('notifications: operation', error));
    return run;
  }

  private async load(): Promise<NotificationsDocument> {
    if (this.doc !== null) return this.doc;
    let text: string;
    const read = this.deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
    for (let attempt = 1; ; attempt += 1) {
      try {
        text = await read(this.path);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // No file until the first entry is stored: nothing to rescue, nothing to report.
          logExpected('notifications: read the file', 'there is no file until the first entry is stored', error);
          this.doc = emptyNotificationsDocument();
          return this.doc;
        }
        // B14 — a lock (EBUSY, EPERM: an antivirus scan, a sync client) is not an absent file. Starting empty
        // would let the next add overwrite every stored entry. Retry briefly, then fail the operation and
        // leave `doc` unset, so nothing is written and the next call reads the file again.
        if (attempt >= READ_ATTEMPTS) {
          logCaught('notifications: read the stored notifications', error);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, this.deps.retryDelayMs ?? READ_RETRY_MS));
      }
    }
    let parsed: unknown;
    let readable = true;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      logExpected('notifications: parse the file', 'a corrupt file is set aside and reported just below', error);
      readable = false;
    }
    const versioned =
      readable && typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version === 1;
    if (!versioned) {
      await this.setAside();
      this.doc = emptyNotificationsDocument();
      return this.doc;
    }
    this.doc = parseNotificationsDocument(parsed);
    return this.doc;
  }

  private async setAside(): Promise<void> {
    try {
      await rename(this.path, `${this.path}.bad`);
      this.deps.log('notifications: the stored notifications could not be read; set aside as notifications.json.bad and started empty');
    } catch (error) {
      logCaught('notifications: set the unreadable file aside', error);
    }
  }

  private async save(doc: NotificationsDocument): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(doc), 'utf8');
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
