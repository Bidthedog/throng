import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  logCaught,
  logExpected,
  parseFormHistory,
  recordFormValue,
  trimFormHistory,
  type FormHistoryField,
  type FormHistoryFile,
  type FormHistoryLists,
} from '@throng/core';

const EMPTY = (): FormHistoryLists => ({ startupCommand: [], shellArguments: [] });

/** Recent values of the New Terminal form, per terminal type, in one JSON file (067 FR-061 to FR-068). */
export class FormHistoryService {
  private file: FormHistoryFile | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly settings: () => { readonly enabled: boolean; readonly maxEntries: number },
    /**
     * Told after the stored lists shrink: a clear, or a trim to a lowered limit. Main hands it the
     * broadcast to every window, so a form already open re-reads (067 FR-064b, FR-066).
     * `flavourId` is absent when every terminal type was affected.
     */
    private readonly changed: (change: { flavourId?: string }) => void = () => undefined,
  ) {}

  /** Nothing is offered while the history is off (FR-064a), though what is stored stays. */
  get(flavourId: string): Promise<FormHistoryLists> {
    return this.enqueue(async () => {
      if (!this.settings().enabled) return EMPTY();
      return (await this.load()).entries[flavourId] ?? EMPTY();
    });
  }

  record(flavourId: string, values: { readonly startupCommand?: string; readonly shellArguments?: string }): Promise<void> {
    return this.enqueue(async () => {
      const { enabled, maxEntries } = this.settings();
      if (!enabled) return;
      const file = await this.load();
      const lists = file.entries[flavourId] ?? EMPTY();
      file.entries[flavourId] = {
        startupCommand: recordFormValue(lists.startupCommand, values.startupCommand ?? '', maxEntries),
        shellArguments: recordFormValue(lists.shellArguments, values.shellArguments ?? '', maxEntries),
      };
      await this.save(file);
    });
  }

  clearField(flavourId: string, field: FormHistoryField): Promise<void> {
    return this.enqueue(async () => {
      const file = await this.load();
      const lists = file.entries[flavourId];
      if (!lists) return;
      file.entries[flavourId] = { ...lists, [field]: [] };
      await this.save(file);
      this.changed({ flavourId });
    });
  }

  /** Delete on a highlighted remembered value (067 FR-133): that one value of that field, for that type. */
  removeValue(flavourId: string, field: FormHistoryField, value: string): Promise<void> {
    return this.enqueue(async () => {
      const file = await this.load();
      const lists = file.entries[flavourId];
      if (!lists?.[field].includes(value)) return;
      file.entries[flavourId] = { ...lists, [field]: lists[field].filter((v) => v !== value) };
      await this.save(file);
      this.changed({ flavourId });
    });
  }

  clearFlavour(flavourId: string): Promise<void> {
    return this.enqueue(async () => {
      const file = await this.load();
      delete file.entries[flavourId];
      await this.save(file);
      this.changed({ flavourId });
    });
  }

  clearAll(): Promise<void> {
    return this.enqueue(async () => {
      const file = await this.load();
      file.entries = {};
      await this.save(file);
      this.changed({});
    });
  }

  /** The limit was lowered: every list goes down to its newest N (FR-065). */
  applyLimit(): Promise<void> {
    return this.enqueue(async () => {
      const file = trimFormHistory(await this.load(), this.settings().maxEntries);
      this.file = file;
      await this.save(file);
      this.changed({});
    });
  }

  /** One at a time, in arrival order: each call reads what the one before it wrote. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.catch((error: unknown) => logCaught('form-history: operation', error));
    return run;
  }

  private async load(): Promise<FormHistoryFile & { entries: Record<string, FormHistoryLists> }> {
    if (this.file === null) {
      try {
        this.file = parseFormHistory(await readFile(this.path, 'utf8'));
      } catch (error) {
        logExpected('form-history: read the file', 'there is no file until a value is first remembered', error);
        this.file = parseFormHistory('');
      }
    }
    return this.file as FormHistoryFile & { entries: Record<string, FormHistoryLists> };
  }

  private async save(file: FormHistoryFile): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(file), 'utf8');
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
