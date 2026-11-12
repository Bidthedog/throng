import { formatGrouped } from '../config/number-format.js';

/** One step of closing throng, as the overlay shows it (067 FR-040, FR-041). */
export interface ShutdownTaskSpec {
  readonly id: string;
  readonly summary: string;
  /** Set on a task closing a project's terminals: the overlay words it, "Closing 4 terminals in X" (FR-041). */
  readonly terminals?: { readonly count: number; readonly projectName: string };
  readonly expectedMs: number;
}

/** What the overlay says a task is doing. The count is grouped here because a process boundary must not carry a grouped figure. */
export function shutdownTaskSummary(task: ShutdownTaskSpec): string {
  if (!task.terminals) return task.summary;
  const { count, projectName } = task.terminals;
  return `Closing ${formatGrouped(count)} terminal${count === 1 ? '' : 's'} in ${projectName}`;
}

export type ShutdownTaskState = 'pending' | 'current' | 'done' | 'cancelled';

export interface ShutdownTaskView extends ShutdownTaskSpec {
  readonly state: ShutdownTaskState;
}

export interface ShutdownView {
  readonly tasks: readonly ShutdownTaskView[];
  readonly remainingMs: number;
  readonly cancelling: boolean;
  /** The current task has run past its expected duration (FR-044). */
  readonly overrunning: boolean;
}

const MAX_RISE = 1.25;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

/** The state of one shutdown, and its time estimate. Pure: the clock is injected and nothing here does any work. */
export class ShutdownRun {
  private readonly states: ShutdownTaskState[];
  private cancelling = false;
  private startedAt = 0;
  private currentIndex = -1;
  private doneExpected = 0;
  private doneActual = 0;
  private previous: number | null = null;

  constructor(
    private readonly specs: readonly ShutdownTaskSpec[],
    private readonly now: () => number,
  ) {
    this.states = specs.map(() => 'pending');
  }

  begin(index: number): void {
    this.states[index] = 'current';
    this.currentIndex = index;
    this.startedAt = this.now();
  }

  finish(index: number): void {
    this.states[index] = 'done';
    this.doneExpected += this.specs[index]!.expectedMs;
    this.doneActual += this.now() - this.startedAt;
    this.currentIndex = -1;
  }

  /** Cancel asked for: nothing further starts. The task running now stays current until it settles (FR-038). */
  cancel(): void {
    this.cancelling = true;
    this.states.forEach((state, i) => {
      if (state === 'pending') this.states[i] = 'cancelled';
    });
  }

  /** The running task was abandoned once Cancel's wait ran out. */
  abandon(index: number): void {
    this.states[index] = 'cancelled';
    this.currentIndex = -1;
  }

  view(): ShutdownView {
    const speed = this.doneExpected > 0 ? clamp(this.doneActual / this.doneExpected, MIN_SPEED, MAX_SPEED) : 1;
    const elapsed = this.currentIndex >= 0 ? this.now() - this.startedAt : 0;
    const expectedNow = this.currentIndex >= 0 ? this.specs[this.currentIndex]!.expectedMs * speed : 0;
    const overrunning = this.currentIndex >= 0 && elapsed > expectedNow;
    const pending = this.specs.reduce((sum, spec, i) => (this.states[i] === 'pending' ? sum + spec.expectedMs * speed : sum), 0);
    let remaining = Math.max(expectedNow - elapsed, 0) + pending;
    if (this.previous !== null && !overrunning && remaining > this.previous * MAX_RISE) remaining = this.previous * MAX_RISE;
    this.previous = remaining;
    return {
      // Field by field: a spec may be a step carrying its work, and a view crosses to the renderer.
      tasks: this.specs.map((spec, i) => ({
        id: spec.id,
        summary: spec.summary,
        expectedMs: spec.expectedMs,
        ...(spec.terminals ? { terminals: spec.terminals } : {}),
        state: this.states[i]!,
      })),
      remainingMs: Math.round(remaining),
      cancelling: this.cancelling,
      overrunning,
    };
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
