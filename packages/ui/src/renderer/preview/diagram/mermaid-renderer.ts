/**
 * The Mermaid block renderer (054 FR-040 – FR-048, research R5) — one renderer for embedded fences and
 * standalone `.mmd`/`.mermaid` previews alike (FR-043).
 *
 * ══ REACHED ONLY BY DYNAMIC IMPORT ══
 *
 * `mermaid` and everything it pulls in ride in the lazy `diagram` chunk, and this module in
 * `app-preview-diagram` (`vite.config.ts`, FR-047). The block registry reaches it with `import()`, and it
 * reaches `mermaid` with `import()` too, so startup and a preview with no diagram load neither.
 *
 * ══ STRICT, THEN SANITISED ══
 *
 * `securityLevel: 'strict'` refuses `click` callbacks and HTML labels; `htmlLabels: false` keeps
 * `foreignObject` out of the output. That is mermaid's half. The SVG string it returns is never inserted as
 * markup: it goes through the diagram profile (`svg-sanitise.ts`), which returns the element the caller
 * draws (FR-045).
 *
 * ══ BOUNDED ══
 *
 * A render that has not finished in `DIAGRAM_RENDER_TIMEOUT_MS` rejects, so a pathological diagram shows the
 * inline notice instead of holding the preview (FR-048). The bound is a safety limit, not a preference —
 * the 044 1 KiB view-state precedent — and is recorded in the plan's Complexity Tracking.
 */
import type { BlockRenderer, BlockRenderOptions } from '../blocks/block-renderers.js';
import type { DiagramTheme } from './diagram-theme.js';
import { sanitiseDiagramSvg, type DiagramSvgSanitiser } from './svg-sanitise.js';

export const DIAGRAM_RENDER_TIMEOUT_MS = 5000;

/** The part of mermaid's API this renderer uses — what a test fakes. */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  parse(text: string): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface MermaidRendererDeps {
  loadMermaid(): Promise<MermaidLike>;
  sanitise: DiagramSvgSanitiser;
  timeoutMs?: number;
}

/** Whether `hex` (`#rgb` or `#rrggbb`) reads as dark; anything unparseable is taken as dark. */
function isDark(colour: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return true;
  const hex = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** Mermaid's `base` theme variables, from the active theme's tokens (FR-046). */
export function mermaidThemeVariables(theme: DiagramTheme): Record<string, string | boolean> {
  return {
    darkMode: isDark(theme.background),
    background: theme.background,
    fontFamily: theme.fontFamily,
    primaryColor: theme.surface,
    primaryTextColor: theme.foreground,
    primaryBorderColor: theme.border,
    secondaryColor: theme.selection,
    tertiaryColor: theme.background,
    lineColor: theme.muted,
    textColor: theme.foreground,
    mainBkg: theme.surface,
    nodeBorder: theme.border,
    clusterBkg: theme.background,
    clusterBorder: theme.border,
    titleColor: theme.foreground,
    edgeLabelBackground: theme.background,
    noteBkgColor: theme.selection,
    noteTextColor: theme.foreground,
    noteBorderColor: theme.border,
    actorBkg: theme.surface,
    actorBorder: theme.border,
    actorTextColor: theme.foreground,
    signalColor: theme.foreground,
    signalTextColor: theme.foreground,
    labelTextColor: theme.foreground,
    pie1: theme.accent,
  };
}

/** What a failure says about the SOURCE: the first line of mermaid's message, never a stack (030 FR-040). */
function diagramError(error: unknown): Error {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const first = message.split(/\r?\n/)[0]?.trim() ?? '';
  return new Error(first.length > 0 ? first.slice(0, 200) : 'The diagram could not be drawn.');
}

let sequence = 0;

export function createMermaidRenderer(deps: MermaidRendererDeps): BlockRenderer {
  const timeoutMs = deps.timeoutMs ?? DIAGRAM_RENDER_TIMEOUT_MS;
  let initialisedFor: string | null = null;

  const draw = async (source: string, { theme }: BlockRenderOptions): Promise<SVGSVGElement> => {
    const mermaid = await deps.loadMermaid();
    if (initialisedFor !== theme.key) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: mermaidThemeVariables(theme),
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
        fontFamily: theme.fontFamily,
        // A `%%{init: …}%%` directive may not override these (mermaid's own lock list): the security level,
        // injected CSS, the font and the HTML-label switch are what keep the output inside the sanitiser's profile.
        secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'themeCSS', 'fontFamily', 'htmlLabels'],
      });
      initialisedFor = theme.key;
    }
    try {
      await mermaid.parse(source);
    } catch (error) {
      throw diagramError(error);
    }
    sequence += 1;
    const id = `throng-diagram-${sequence}`;
    let svg: string;
    try {
      ({ svg } = await mermaid.render(id, source));
    } catch (error) {
      throw diagramError(error);
    } finally {
      // Mermaid measures in a scratch element it adds to the document; an error can leave it behind.
      globalThis.document?.getElementById(`d${id}`)?.remove();
    }
    const element = deps.sanitise(svg);
    if (element === null) throw new Error('The diagram could not be drawn.');
    return element;
  };

  return {
    render(source, options) {
      return new Promise<SVGSVGElement>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`The diagram took longer than ${timeoutMs / 1000} seconds to draw.`)),
          timeoutMs,
        );
        draw(source, options).then(
          (svg) => {
            clearTimeout(timer);
            resolve(svg);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : diagramError(error));
          },
        );
      });
    },
  };
}

/** The app's Mermaid renderer: the real library, by dynamic import, and the window's diagram sanitiser. */
export const mermaidBlockRenderer: BlockRenderer = createMermaidRenderer({
  loadMermaid: () => import('mermaid').then((m) => m.default as unknown as MermaidLike),
  sanitise: sanitiseDiagramSvg,
});
