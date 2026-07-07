// Shared JSON-RPC 2.0 message shapes for the UI<->daemon channel. The only
// method in the bootstrap iteration is `health.ping` (see
// specs/001-app-bootstrap/contracts/ipc-health-ping.md).

export const HEALTH_PING_METHOD = 'health.ping';

/** JSON-RPC standard error code for an unknown method. */
export const JSON_RPC_METHOD_NOT_FOUND = -32601;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: '2.0';
  id: number;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccess<TResult>
  | JsonRpcErrorResponse;

/** `health.ping` request params (empty in this iteration). */
export type HealthPingParams = Record<string, never>;

export type HealthPingRequest = JsonRpcRequest<HealthPingParams> & {
  method: typeof HEALTH_PING_METHOD;
};

/** Successful `health.ping` result payload. */
export interface HealthPongResult {
  status: 'ok';
  /** ISO-8601 UTC timestamp captured when the daemon started. */
  daemonStartedAt: string;
  /** The daemon process id. */
  pid: number;
  /** Build id of the daemon's code (from dist/BUILD_ID) — the UI restarts a
   *  daemon whose build id no longer matches the current build. */
  buildId?: string;
  /** Whether the daemon process runs elevated (FR-025b). An elevated app retires a
   *  non-elevated daemon and respawns it elevated so terminals can run "as admin". */
  elevated?: boolean;
}

/** Client-side outcome: the daemon answered the ping. */
export interface DaemonAvailable extends HealthPongResult {
  available: true;
}

/** Client-side outcome: the daemon could not be reached (FR-010). */
export interface DaemonUnavailable {
  available: false;
  reason: string;
}

export type DaemonStatus = DaemonAvailable | DaemonUnavailable;
