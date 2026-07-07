// Typed renderer-side bridge to the daemon's JSON-RPC methods, wrapping the
// sandboxed preload `window.throng.invoke`. Unwraps the { ok, result | error }
// envelope and rethrows daemon errors as a typed RpcError carrying the JSON-RPC
// code (002 / research D9/D10). Injected at the renderer composition root.

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface ThrongBridge {
  invoke<TResult>(method: string, params?: unknown): Promise<TResult>;
}

/** Build the real bridge over the preload contextBridge. */
export function createBridge(): ThrongBridge {
  return {
    async invoke<TResult>(method: string, params: unknown = {}): Promise<TResult> {
      const api = window.throng;
      if (!api?.invoke) {
        throw new RpcError('throng daemon bridge is unavailable', null);
      }
      const envelope = await api.invoke(method, params);
      if (envelope.ok) {
        return envelope.result as TResult;
      }
      const error = envelope.error ?? { code: null, message: 'unknown daemon error' };
      throw new RpcError(error.message, error.code);
    },
  };
}
