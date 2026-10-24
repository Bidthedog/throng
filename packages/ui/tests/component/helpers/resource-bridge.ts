/**
 * A stand-in for `window.throng.resources` (055, contracts/resources-ipc-055.md): records every call
 * and lets a test push summaries, detail frames and routed actions the way UI main would.
 */
import type { DetailFrame, KillRequest, KillResult, PanelEstimate, ResourceSummary, WorkspaceContext } from '@throng/ipc-contract';
import type { RoutedAction } from '../../../src/renderer/resources/route-action.js';

type Rect = { x: number; y: number; width: number; height: number };

export interface ResourcesBridge {
  /** Resolve the pending `summary()` read (default: resolves immediately with `initial`). */
  pushSummary(s: ResourceSummary): void;
  pushDetail(f: DetailFrame): void;
  readonly subscribed: number[];
  readonly unsubscribed: number[];
  readonly detailListeners: () => number;
  readonly kills: KillRequest[];
  readonly opens: () => number;
  readonly reports: { context: WorkspaceContext | null; estimates: readonly PanelEstimate[] }[];
  setKillResult(r: KillResult): void;
  /** What `routeAction` is told, newest last; its answer is `routed` (default false: no other window). */
  readonly routed: RoutedAction[];
  setRouteAnswer(answer: boolean): void;
  /** Deliver an action another window routed to this one. */
  fireAction(req: RoutedAction): void;
  /** What this window answered main about an Activate it was sent: did it get there (review finding 9). */
  readonly answers: { requestId: number; ok: boolean }[];
  /** Deliver a change of detail demand. */
  fireDemand(on: boolean): void;
  setDemand(on: boolean): void;
  /** Every Minimise the monitor window sent main, with its reduced-motion flag. */
  readonly minimised: { reducedMotion: boolean }[];
  /** Every view the monitor window saved. */
  readonly savedViews: unknown[];
  /** The view main holds for the monitor window (default `null`: the first open). */
  setStoredView(v: unknown): void;
  /** Ask the registered status-rect answerer as main would; `undefined` when none is registered. */
  askStatusRect(): Rect | null | undefined;
}

export function installResourcesBridge(initial: ResourceSummary | null = null): ResourcesBridge {
  const summaryListeners = new Set<(s: ResourceSummary) => void>();
  const detailListeners = new Set<(f: DetailFrame) => void>();
  const rectAnswerers = new Set<() => Rect | null>();
  const subscribed: number[] = [];
  const unsubscribed: number[] = [];
  const kills: KillRequest[] = [];
  const reports: ResourcesBridge['reports'] = [];
  const minimised: ResourcesBridge['minimised'] = [];
  const savedViews: unknown[] = [];
  let storedView: unknown = null;
  let opens = 0;
  let nextId = 1;
  let killResult: KillResult = { results: [] };
  const actionListeners = new Set<(req: RoutedAction) => void>();
  const demandListeners = new Set<(on: boolean) => void>();
  const routed: ResourcesBridge['routed'] = [];
  const answers: ResourcesBridge['answers'] = [];
  let routeAnswer = false;
  let demand = false;

  const throng = ((window as unknown as { throng?: Record<string, unknown> }).throng ?? {}) as Record<string, unknown>;
  throng.resources = {
    summary: () => Promise.resolve(initial),
    onSummary: (cb: (s: ResourceSummary) => void) => {
      summaryListeners.add(cb);
      return () => summaryListeners.delete(cb);
    },
    subscribeDetail: () => {
      const subscriptionId = nextId++;
      subscribed.push(subscriptionId);
      return Promise.resolve({ subscriptionId });
    },
    unsubscribeDetail: (id: number) => {
      unsubscribed.push(id);
      return Promise.resolve();
    },
    onDetail: (cb: (f: DetailFrame) => void) => {
      detailListeners.add(cb);
      return () => detailListeners.delete(cb);
    },
    reportPanels: (context: WorkspaceContext | null, estimates: readonly PanelEstimate[]) => {
      reports.push({ context, estimates });
    },
    kill: (req: KillRequest) => {
      kills.push(req);
      return Promise.resolve(killResult);
    },
    routeAction: (req: RoutedAction) => {
      routed.push(req);
      return Promise.resolve(routeAnswer);
    },
    onAction: (cb: (req: RoutedAction) => void) => {
      actionListeners.add(cb);
      return () => actionListeners.delete(cb);
    },
    answerAction: (requestId: number, ok: boolean) => {
      answers.push({ requestId, ok });
    },
    detailDemand: () => Promise.resolve(demand),
    onDetailDemand: (cb: (on: boolean) => void) => {
      demandListeners.add(cb);
      return () => demandListeners.delete(cb);
    },
    open: () => {
      opens += 1;
    },
    minimise: (opts: { reducedMotion: boolean }) => {
      minimised.push(opts);
    },
    viewState: () => Promise.resolve(storedView),
    saveViewState: (v: unknown) => {
      savedViews.push(v);
    },
    onStatusRectRequest: (cb: () => Rect | null) => {
      rectAnswerers.add(cb);
      return () => rectAnswerers.delete(cb);
    },
  };
  Reflect.set(window, 'throng', throng);

  return {
    pushSummary: (s) => summaryListeners.forEach((l) => l(s)),
    pushDetail: (f) => detailListeners.forEach((l) => l(f)),
    subscribed,
    unsubscribed,
    detailListeners: () => detailListeners.size,
    kills,
    opens: () => opens,
    reports,
    setKillResult: (r) => {
      killResult = r;
    },
    routed,
    setRouteAnswer: (a) => {
      routeAnswer = a;
    },
    fireAction: (req) => actionListeners.forEach((l) => l(req)),
    answers,
    fireDemand: (on) => demandListeners.forEach((l) => l(on)),
    setDemand: (on) => {
      demand = on;
    },
    minimised,
    savedViews,
    setStoredView: (v) => {
      storedView = v;
    },
    askStatusRect: () => {
      const first = [...rectAnswerers][0];
      return first === undefined ? undefined : first();
    },
  };
}
