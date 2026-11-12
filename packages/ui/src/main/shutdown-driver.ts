import { logCaught, ShutdownRun, type ShutdownTaskSpec, type ShutdownView } from '@throng/core';

/** One shutdown step and the work it does. `run` may honour `signal`; a step that does not is simply abandoned. */
export interface ShutdownStep extends ShutdownTaskSpec {
  run(signal: AbortSignal): Promise<void>;
}

/** How long Cancel waits for the step in progress before abandoning it (FR-038). */
export const CANCEL_WAIT_MS = 5000;

/**
 * Runs the steps of one shutdown in order and makes them cancellable (067 FR-037, FR-038). Publishes a view on every
 * change. Cancel is ignored once {@link pointOfNoReturn} has been called.
 */
export class ShutdownDriver {
  private cancelRequested = false;
  private pastNoReturn = false;
  private run_: ShutdownRun | null = null;
  private onCancel: (() => void) | null = null;

  constructor(
    private readonly publish: (view: ShutdownView) => void,
    private readonly now: () => number,
    private readonly cancelWaitMs: number = CANCEL_WAIT_MS,
  ) {}

  get cancelled(): boolean {
    return this.cancelRequested;
  }

  cancel(): void {
    if (this.pastNoReturn || this.cancelRequested) return;
    this.cancelRequested = true;
    if (this.run_) {
      this.run_.cancel();
      this.publish(this.run_.view());
    }
    this.onCancel?.();
  }

  pointOfNoReturn(): void {
    this.pastNoReturn = true;
  }

  async run(steps: readonly ShutdownStep[]): Promise<'completed' | 'cancelled'> {
    if (this.cancelRequested) return 'cancelled';
    const run = new ShutdownRun(steps, this.now);
    this.run_ = run;
    for (const [index, step] of steps.entries()) {
      if (this.cancelRequested) return 'cancelled';
      run.begin(index);
      this.publish(run.view());
      const finished = await this.settle(step);
      if (finished) run.finish(index);
      else run.abandon(index);
      this.publish(run.view());
    }
    return this.cancelRequested ? 'cancelled' : 'completed';
  }

  /** True when the step ended by itself, false when Cancel's wait ran out first. */
  private settle(step: ShutdownStep): Promise<boolean> {
    const controller = new AbortController();
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (finished: boolean): void => {
        if (timer !== undefined) clearTimeout(timer);
        this.onCancel = null;
        resolve(finished);
      };
      const startWait = (): void => {
        timer = setTimeout(() => {
          controller.abort();
          done(false);
        }, this.cancelWaitMs);
      };
      this.onCancel = startWait;
      if (this.cancelRequested) startWait();
      step.run(controller.signal).then(
        () => done(true),
        (error: unknown) => {
          logCaught(`shutdown: ${step.id}`, error);
          done(true);
        },
      );
    });
  }
}
