/**
 * A stand-in for `window.throng.resources` (055, contracts/resources-ipc-055.md): records every call
 * and lets a test push summaries, detail frames and open requests the way UI main would.
 */
import type { DetailFrame, KillRequest, KillResult, PanelEstimate, ResourceSummary, WorkspaceContext } from '@throng/ipc-contract';

export interface ResourcesBridge {
  /** Resolve the pending `summary()` read (default: resolves immediately with `initial`). */
  pushSummary(s: ResourceSummary): void;
  pushDetail(f: DetailFrame): void;
  fireOpenRequest(): void;
  readonly subscribed: number[];
  readonly unsubscribed: number[];
  readonly detailListeners: () => number;
  readonly kills: KillRequest[];
  readonly opens: () => number;
  readonly reports: { context: WorkspaceContext | null; estimates: readonly PanelEstimate[] }[];
  setKillResult(r: KillResult): void;
  /** What `routeAction` is told, newest last; its answer is `routed` (default false: no other window). */
  readonly routed: { action: 'destroyTab' | 'destroyPanel'; id: string }[];
  setRouteAnswer(answer: boolean): void;
  /** Deliver an action another window routed to this one. */
  fireAction(req: { action: 'destroyTab' | 'destroyPanel'; id: string }): void;
  /** Deliver a change of detail demand. */
  fireDemand(on: boolean): void;
  setDemand(on: boolean): void;
}

export function installResourcesBridge(initial: ResourceSummary | null = null): ResourcesBridge {
  const summaryListeners = new Set<(s: ResourceSummary) => void>();
  const detailListeners = new Set<(f: DetailFrame) => void>();
  const openListeners = new Set<() => void>();
  const subscribed: number[] = [];
  const unsubscribed: number[] = [];
  const kills: KillRequest[] = [];
  const reports: ResourcesBridge['reports'] = [];
  let opens = 0;
  let nextId = 1;
  let killResult: KillResult = { results: [] };
  const actionListeners = new Set<(req: { action: 'destroyTab' | 'destroyPanel'; id: string }) => void>();
  const demandListeners = new Set<(on: boolean) => void>();
  const routed: ResourcesBridge['routed'] = [];
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
    routeAction: (req: { action: 'destroyTab' | 'destroyPanel'; id: string }) => {
      routed.push(req);
      return Promise.resolve(routeAnswer);
    },
    onAction: (cb: (req: { action: 'destroyTab' | 'destroyPanel'; id: string }) => void) => {
      actionListeners.add(cb);
      return () => actionListeners.delete(cb);
    },
    detailDemand: () => Promise.resolve(demand),
    onDetailDemand: (cb: (on: boolean) => void) => {
      demandListeners.add(cb);
      return () => demandListeners.delete(cb);
    },
    open: () => {
      opens += 1;
    },
    onOpenRequest: (cb: () => void) => {
      openListeners.add(cb);
      return () => openListeners.delete(cb);
    },
  };
  Reflect.set(window, 'throng', throng);

  return {
    pushSummary: (s) => summaryListeners.forEach((l) => l(s)),
    pushDetail: (f) => detailListeners.forEach((l) => l(f)),
    fireOpenRequest: () => openListeners.forEach((l) => l()),
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
    fireDemand: (on) => demandListeners.forEach((l) => l(on)),
    setDemand: (on) => {
      demand = on;
    },
  };
}
