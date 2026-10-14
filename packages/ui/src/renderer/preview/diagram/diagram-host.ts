/**
 * The element a diagram is drawn into, as the rest of the preview recognises it (054 US4): the body puts
 * one where each claimed fence was; find leaves it out of the text it searches (FR-032); copy puts the
 * diagram's source or image in its place (FR-049a).
 */

/** The host's class — `diagram.css` lays it out, and `preview-search-model.ts` excludes it by name. */
export const DIAGRAM_HOST_CLASS = 'preview-diagram-host';

/** The diagram's source, as written in its fence, for a plain-text copy. */
export const DIAGRAM_SOURCE_ATTRIBUTE = 'data-diagram-source';

/**
 * A place a diagram will be drawn into once its source is read — a Markdown embed before its file answers.
 * Provider-neutral, so a Find in Files reveal can wait for the diagram without knowing what an embed is
 * (`reveal-match.ts`, FR-070).
 */
export const DIAGRAM_PENDING_ATTRIBUTE = 'data-diagram-pending';

/**
 * A host a Find in Files match revealed (2026-10-13): its text is drawn as the diagram, so the diagram is what
 * is marked, for {@link DIAGRAM_REVEALED_MS} — `diagram.css` fades the mark out over that time.
 */
export const DIAGRAM_REVEALED_CLASS = 'preview-diagram-host--revealed';
export const DIAGRAM_REVEALED_MS = 1600;

/** The fence language the diagram was claimed for. */
export const DIAGRAM_LANG_ATTRIBUTE = 'data-diagram-lang';

/**
 * FR-046m (manual test change request, 2026-10-13) — the box height the document gives a diagram, in CSS
 * pixels: ```` ```mermaid height=300 ```` on a fence, `![[flow.mmd|300]]` on an embed. Carried on the code
 * element (and the embed placeholder) through the sanitiser, which admits it by name.
 */
export const DIAGRAM_HEIGHT_ATTRIBUTE = 'data-diagram-height';

/** The tallest box a document may ask for; anything taller is not a height. */
export const MAX_DIAGRAM_HEIGHT = 10_000;

/** A height as written — whole pixels, no unit, 1 to {@link MAX_DIAGRAM_HEIGHT} — or `null`. */
export function parseDiagramHeight(text: string | null | undefined): number | null {
  if (text === null || text === undefined || !/^\d{1,5}$/.test(text)) return null;
  const height = Number(text);
  return height >= 1 && height <= MAX_DIAGRAM_HEIGHT ? height : null;
}

/** Marks the image a rich copy put in a diagram's place, for the export profile to admit (FR-049a). */
export const DIAGRAM_IMAGE_ATTRIBUTE = 'data-throng-diagram-image';

/** The only shape a copied diagram image may take — the export profile admits this and nothing else. */
export const DIAGRAM_PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
