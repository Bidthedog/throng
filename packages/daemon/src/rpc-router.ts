import {
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_NOT_FOUND,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '@throng/ipc-contract';
import { ProjectNotFoundError, ProjectValidationError } from '@throng/core';

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/** An error a handler can throw to control its JSON-RPC error code. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly rpcCode: number,
    /**
     * Structured payload travelling with the failure (029). JSON-RPC's own `error.data` slot,
     * unused here until now.
     *
     * It exists because a CAUSE cannot be re-derived at the far end: `error.code` on the wire is a
     * numeric JSON-RPC code, not an errno, and the errno only exists where the throw happened. The
     * alternative — pattern-matching our own internal message strings in the renderer — is exactly
     * the fragility 029 removes.
     */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * Method registry + dispatcher for the named-pipe JSON-RPC server (002 / research
 * D10). Handlers register by method name; `handle` runs the matching handler and
 * maps domain errors to JSON-RPC codes:
 *   - {@link ProjectValidationError} / {@link RpcError}(invalid) → -32602
 *   - {@link ProjectNotFoundError} → -32004
 *   - unknown method → -32601
 *   - anything else → -32603 (internal)
 * Keeps the wire transport unaware of any specific domain (SRP/DIP).
 */
export class RpcRouter {
  private readonly handlers = new Map<string, RpcHandler>();

  register(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      return this.error(request.id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${request.method}`);
    }
    try {
      const result = await handler(request.params);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      return this.mapError(request.id, error);
    }
  }

  private mapError(id: number, error: unknown): JsonRpcResponse {
    if (error instanceof ProjectValidationError) {
      return this.error(id, JSON_RPC_INVALID_PARAMS, error.message);
    }
    if (error instanceof ProjectNotFoundError) {
      return this.error(id, JSON_RPC_NOT_FOUND, error.message);
    }
    if (error instanceof RpcError) {
      return this.error(id, error.rpcCode, error.message, error.data);
    }
    return this.error(id, -32603, `Internal error: ${(error as Error).message}`);
  }

  private error(id: number, code: number, message: string, data?: unknown): JsonRpcResponse {
    // `data` is omitted entirely when absent, so every existing response is byte-identical to before.
    return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
  }
}
