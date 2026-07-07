/**
 * IFileWatcher (Principle II) — watches a directory and reports changes, driving
 * config hot-reload (research D3). The abstract contract only; the concrete
 * chokidar-backed implementation lives in `platform-windows`.
 */

/** A handle that stops a watch when disposed. */
export interface Disposable {
  dispose(): void;
}

export interface IFileWatcher {
  /**
   * Begin watching `dir`; `onChange(path)` fires (debounced) on create/modify/
   * delete of a file within it. Disposing the returned handle stops callbacks.
   */
  watch(dir: string, onChange: (path: string) => void): Disposable;
}
