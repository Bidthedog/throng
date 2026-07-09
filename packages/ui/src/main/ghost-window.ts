import { BrowserWindow, ipcMain, screen } from 'electron';

/**
 * Cursor-following drag ghost as a real OS window (FR-001). A DOM overlay cannot
 * paint outside the application window, so the ghost is a frameless, transparent,
 * always-on-top, click-through window that tracks the cursor in screen
 * coordinates — staying visible when a panel/tab is dragged to (or beyond) the
 * app's edge. Shown on `throng:ghost:start`, hidden on `throng:ghost:stop`.
 *
 * The window's document is loaded **once** (a shell with a `__renderGhost(kind,
 * title)` hook); each drag only swaps the content via `executeJavaScript` and
 * resizes/shows the window. Re-navigating per drag (the old approach) tore down
 * and recreated the render widget while `setSize`/`show`/`setPosition` were
 * sending it `UpdateVisualProperties` — the race that logged
 * "Message 2 rejected by interface blink.mojom.Widget" on every drag.
 */

interface GhostPayload {
  kind: 'panel' | 'tab';
  title: string;
}

const SIZE = {
  panel: { width: 240, height: 188 },
  tab: { width: 220, height: 64 },
} as const;

let ghost: BrowserWindow | null = null;
let ghostReady: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setInterval> | null = null;

/** Ghost theme tokens. Defaults are the `throng` theme; overwritten live from the
 *  active theme via {@link setGhostTheme} so the ghost follows the current theme
 *  (rather than staying the default blue). */
export interface GhostColours {
  surface: string;
  surfaceActive: string;
  text: string;
  accent: string;
  border: string;
}
let ghostColours: GhostColours = {
  surface: '#1e1f23',
  surfaceActive: '#2a2d34',
  text: '#e6e6e6',
  accent: '#6aa3ff',
  border: '#34363c',
};

/** The ghost's one-time shell. Content is set later via `__renderGhost`, which
 *  uses `textContent` (no HTML interpolation → no escaping/XSS concerns). Colours
 *  are CSS custom properties on :root, injected/updated by {@link applyGhostColours}
 *  from the active theme; the literals here are only the pre-theme fallback. */
function shellHtml(): string {
  const C = ghostColours;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--g-surface:${C.surface};--g-surface-active:${C.surfaceActive};--g-text:${C.text};--g-accent:${C.accent};--g-border:${C.border}}
    html,body{margin:0;background:transparent;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
    .g{opacity:.9;box-shadow:0 8px 24px rgba(0,0,0,.5);border:1px solid var(--g-accent);border-radius:6px;box-sizing:border-box}
    .panel{width:236px;height:156px;background:var(--g-surface);display:flex;flex-direction:column;overflow:hidden}
    .panel .h{padding:6px 10px;font-size:12px;color:var(--g-text);background:var(--g-surface-active);border-bottom:1px solid var(--g-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .panel .b{flex:1;opacity:.4;background:repeating-linear-gradient(45deg,transparent,transparent 8px,var(--g-border) 8px,var(--g-border) 9px)}
    .tab{display:inline-block;padding:6px 14px;font-size:12px;color:var(--g-text);background:var(--g-surface-active)}
    /* Drop-target hint: shows where a cross-window drop will land (item 5 fallback). */
    .hint{display:none;margin-top:6px;font-size:11px;color:var(--g-text);background:var(--g-accent);border-radius:4px;padding:3px 9px;white-space:nowrap;max-width:222px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgba(0,0,0,.5)}
    .hint.show{display:inline-block}
    /* Invalid-drop warning (e.g. dragging a sub-workspace-owned panel out). */
    .hint.warn{background:#c0392b;color:#fff}
  </style></head><body>
    <div id="ghost-root"></div>
    <div class="hint" id="ghost-hint"></div>
    <script>
      window.__renderGhost = function (kind, title) {
        var root = document.getElementById('ghost-root');
        if (!root) return;
        if (kind === 'tab') {
          root.innerHTML = '<div class="g tab"></div>';
          root.querySelector('.tab').textContent = title;
        } else {
          root.innerHTML = '<div class="g panel"><div class="h"></div><div class="b"></div></div>';
          root.querySelector('.h').textContent = title;
        }
        // Fresh drag → clear any hint left over from the previous one (the old
        // per-drag reload used to do this implicitly).
        var hint = document.getElementById('ghost-hint');
        if (hint) { hint.textContent = ''; hint.classList.remove('show'); }
      };
    </script>
  </body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(doc)}`;
}

function ensureGhost(): BrowserWindow {
  if (ghost && !ghost.isDestroyed()) return ghost;
  ghost = new BrowserWindow({
    width: SIZE.panel.width,
    height: SIZE.panel.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ghost.setIgnoreMouseEvents(true);
  ghost.setAlwaysOnTop(true, 'screen-saver');
  // Load the shell ONCE; never re-navigate (see file header).
  ghostReady = ghost.webContents.loadURL(shellHtml()).catch(() => {
    /* a destroyed/closing ghost can reject the load; ignore */
  });
  applyGhostColours(); // in case the theme changed since the shell literals
  return ghost;
}

/** Push the current theme colours onto the loaded ghost as CSS custom properties. */
function applyGhostColours(): void {
  const win = ghost;
  if (!win || win.isDestroyed()) return;
  const c = ghostColours;
  const js =
    `(()=>{const s=document.documentElement.style;` +
    `s.setProperty('--g-surface',${JSON.stringify(c.surface)});` +
    `s.setProperty('--g-surface-active',${JSON.stringify(c.surfaceActive)});` +
    `s.setProperty('--g-text',${JSON.stringify(c.text)});` +
    `s.setProperty('--g-accent',${JSON.stringify(c.accent)});` +
    `s.setProperty('--g-border',${JSON.stringify(c.border)});})()`;
  void ghostReady.then(() => {
    if (win.isDestroyed()) return;
    win.webContents.executeJavaScript(js).catch(() => {
      /* shell not ready / window gone — ignore */
    });
  });
}

/**
 * Update the drag ghost's colours from the active theme (FR-030 — the ghost must
 * follow the theme, not stay the default blue). Applied live if the ghost exists,
 * and baked into the shell literals for the next ghost that is created.
 */
export function setGhostTheme(colours: GhostColours): void {
  ghostColours = { ...colours };
  applyGhostColours();
}

/** Swap the ghost's content for this drag, once its shell has loaded. */
function renderGhost(kind: 'panel' | 'tab', title: string): void {
  const win = ghost;
  if (!win || win.isDestroyed()) return;
  void ghostReady.then(() => {
    if (win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(`window.__renderGhost(${JSON.stringify(kind)}, ${JSON.stringify(title)})`)
      .catch(() => {
        /* shell not ready / window gone — ignore */
      });
  });
}

function positionAtCursor(): void {
  if (!ghost || ghost.isDestroyed() || !ghost.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  ghost.setPosition(p.x, p.y); // top-left at the cursor (FR-001)
}

function stopGhost(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (ghost && !ghost.isDestroyed()) ghost.hide();
}

/** Wire the drag-ghost IPC. Call once at app startup. */
export function registerGhostIpc(): void {
  ipcMain.on('throng:ghost:start', (_event, payload: GhostPayload) => {
    if (!payload || (payload.kind !== 'panel' && payload.kind !== 'tab')) return;
    const win = ensureGhost();
    const size = SIZE[payload.kind];
    win.setSize(size.width, size.height);
    renderGhost(payload.kind, payload.title ?? '');
    positionAtCursor();
    win.showInactive();
    positionAtCursor();
    // Movement is driven event-by-event from the renderer's pointermove
    // (`throng:ghost:tick`) for smoothness; this slow interval is only a safety
    // net in case ticks stop arriving.
    if (timer) clearInterval(timer);
    timer = setInterval(positionAtCursor, 100);
  });

  // Each renderer pointer frame: reposition immediately (vsync-paced, no poll lag).
  ipcMain.on('throng:ghost:tick', positionAtCursor);

  // Drop-target hint (item 5): the renderer resolves where a cross-window drop
  // would land and sends the label; we update the ghost's hint badge in place
  // (executeJavaScript, so no reload/flicker). Empty text hides it.
  ipcMain.on('throng:ghost:hint', (_event, payload: unknown) => {
    if (!ghost || ghost.isDestroyed()) return;
    // Back-compat: a bare string is a normal (accent) hint; an object may carry a
    // `warn` flag that styles the hint red for an invalid drop (FR-030).
    const label = typeof payload === 'string' ? payload : String((payload as { text?: unknown })?.text ?? '');
    const warn = typeof payload === 'object' && payload !== null && (payload as { warn?: unknown }).warn === true;
    const js = label
      ? `(()=>{const h=document.getElementById('ghost-hint');if(h){h.textContent=${JSON.stringify(label)};h.classList.${warn ? 'add' : 'remove'}('warn');h.classList.add('show')}})()`
      : `(()=>{const h=document.getElementById('ghost-hint');if(h){h.classList.remove('warn');h.classList.remove('show')}})()`;
    ghost.webContents.executeJavaScript(js).catch(() => {
      /* ghost may be mid-reload; ignore */
    });
  });

  ipcMain.on('throng:ghost:stop', stopGhost);
}
