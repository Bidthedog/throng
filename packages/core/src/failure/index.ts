/**
 * 029 — failure causes and daemon liveness.
 *
 * One concept shared by the daemon, the main process and the renderer, which is why it lives here
 * rather than in any one of them.
 */
export {
  classifyFailure,
  causeMessage,
  causeKey,
  startFailurePreservesPanelType,
  isTransportFailure,
  type FailureKind,
  type FailureOperation,
  type Holder,
  type FailureCause,
  type ClassifyOptions,
  type CauseMessageOptions,
} from './cause.js';
export {
  nextDaemonState,
  initialDaemonState,
  DAEMON_GRACE_MS,
  type DaemonStatus,
  type DaemonState,
  type DaemonEvent,
} from './daemon-state.js';
