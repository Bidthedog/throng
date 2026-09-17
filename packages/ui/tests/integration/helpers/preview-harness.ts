import type {
  AppSettings,
  Disposable,
  IFileWatcher,
  PreviewFocusMessage,
  PreviewOpenChanged,
  PreviewPathChanged,
  PreviewPlaceMessage,
  PreviewUpdate,
  SettleClock,
} from '@throng/core';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import type { DocumentLifecycleListener } from '../../../src/main/editor-coordinator.js';

/**
 * Shared test doubles for the `PreviewService` suites (044 T057–T059, T061).
 *
 * Every double here records rather than asserts, so each test states its own expectation against
 * what the service actually did.
 */

/** A clock the test moves by hand — the scheduler and the reservation timeout both run on it. */
export class FakeClock implements SettleClock {
  private time = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.time + Math.max(0, ms), callback });
    return this.seq;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** How many timers are armed and not yet fired or cleared. */
  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Move time forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= end && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const due = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.time = due.at;
      due.callback();
    }
    this.time = end;
  }
}

/** Everything the service pushed, by kind. */
export interface RecordedPush {
  updates: Array<{ to: number; update: PreviewUpdate }>;
  openChanged: PreviewOpenChanged[];
  pathChanged: PreviewPathChanged[];
  focus: Array<{ to: number; payload: PreviewFocusMessage }>;
  place: Array<{ to: number; payload: PreviewPlaceMessage }>;
  clear(): void;
}

export function recordingPush(): RecordedPush & {
  /** Windows that are gone: a `place` sent to one is recorded but reports undelivered. */
  dead: Set<number>;
  update(to: number, update: PreviewUpdate): void;
  broadcastOpenChanged(payload: PreviewOpenChanged): void;
  broadcastPathChanged(payload: PreviewPathChanged): void;
  sendFocus(to: number, payload: PreviewFocusMessage): void;
  sendPlace(to: number, payload: PreviewPlaceMessage): boolean;
} {
  const record = {
    dead: new Set<number>(),
    updates: [] as RecordedPush['updates'],
    openChanged: [] as PreviewOpenChanged[],
    pathChanged: [] as PreviewPathChanged[],
    focus: [] as RecordedPush['focus'],
    place: [] as RecordedPush['place'],
    clear() {
      record.updates.length = 0;
      record.openChanged.length = 0;
      record.pathChanged.length = 0;
      record.focus.length = 0;
      record.place.length = 0;
    },
    update: (to: number, update: PreviewUpdate) => void record.updates.push({ to, update }),
    broadcastOpenChanged: (payload: PreviewOpenChanged) => void record.openChanged.push(payload),
    broadcastPathChanged: (payload: PreviewPathChanged) => void record.pathChanged.push(payload),
    sendFocus: (to: number, payload: PreviewFocusMessage) => void record.focus.push({ to, payload }),
    sendPlace: (to: number, payload: PreviewPlaceMessage): boolean => {
      record.place.push({ to, payload });
      return !record.dead.has(to);
    },
  };
  return record;
}

/** The windows the service may raise, and which one is the main window. */
export function recordingWindows(main: number | null = 1): {
  raised: number[];
  main: number | null;
  mainWindowId(): number | null;
  raise(webContentsId: number): void;
} {
  const windows = {
    raised: [] as number[],
    main,
    mainWindowId: () => windows.main,
    raise: (id: number) => void windows.raised.push(id),
  };
  return windows;
}

/** A watcher the test fires by hand, for suites that are not about the real one. */
export function manualWatcher(): IFileWatcher & {
  watched: string[];
  fire(dir?: string): void;
} {
  const live = new Map<number, { dir: string; onChange: (path: string) => void }>();
  let seq = 0;
  return {
    get watched() {
      return [...live.values()].map((w) => w.dir);
    },
    watch(dir: string, onChange: (path: string) => void): Disposable {
      seq += 1;
      const id = seq;
      live.set(id, { dir, onChange });
      return { dispose: () => void live.delete(id) };
    },
    fire(dir?: string) {
      for (const w of [...live.values()]) if (dir === undefined || w.dir === dir) w.onChange(w.dir);
    },
  };
}

/** Live, mutable settings — the service must read them on every use. */
export function liveSettings(): { current: AppSettings; get: () => AppSettings } {
  const holder = { current: structuredClone(DEFAULT_APP_SETTINGS) as AppSettings, get: () => holder.current };
  return holder;
}

/**
 * A listener slot filled after construction: the coordinator needs its listener at construction, and
 * the service needs the coordinator — the same late binding `main.ts` uses.
 */
export function lateListener(): DocumentLifecycleListener & {
  bind(target: DocumentLifecycleListener): void;
  /** While muted, every event is dropped — so a test can deliver one itself, at a moment it chooses. */
  muted: boolean;
} {
  let target: DocumentLifecycleListener | null = null;
  const relay = {
    muted: false,
    bind: (t: DocumentLifecycleListener) => {
      target = t;
    },
    registered: (p: string, d: string) => void (relay.muted || target?.registered(p, d)),
    unregistered: (p: string, d: string) => void (relay.muted || target?.unregistered(p, d)),
    repointed: (f: string, t: string, d: string) => void (relay.muted || target?.repointed(f, t, d)),
    changed: (d: string) => void (relay.muted || target?.changed(d)),
    dirtyChanged: (d: string, dirty: boolean) => void (relay.muted || target?.dirtyChanged(d, dirty)),
  };
  return relay;
}

/** A promise the test resolves by hand — to hold a service inside one of its awaits. */
export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Poll until `get` returns something other than `undefined`, on the REAL clock. */
export async function until<T>(get: () => T | undefined, ms = 4000): Promise<T | undefined> {
  for (let i = 0; i < ms / 20; i++) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return get();
}
