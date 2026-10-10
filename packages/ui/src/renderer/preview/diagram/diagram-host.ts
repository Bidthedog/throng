/**
 * The element a diagram is drawn into, as the rest of the preview recognises it (054 US4): the body puts
 * one where each claimed fence was; find leaves it out of the text it searches (FR-032); copy puts the
 * diagram's source or image in its place (FR-049a).
 */

/** The host's class — `diagram.css` lays it out, and `preview-search-model.ts` excludes it by name. */
export const DIAGRAM_HOST_CLASS = 'preview-diagram-host';

/** The diagram's source, as written in its fence, for a plain-text copy. */
export const DIAGRAM_SOURCE_ATTRIBUTE = 'data-diagram-source';

/** The fence language the diagram was claimed for. */
export const DIAGRAM_LANG_ATTRIBUTE = 'data-diagram-lang';

/** Marks the image a rich copy put in a diagram's place, for the export profile to admit (FR-049a). */
export const DIAGRAM_IMAGE_ATTRIBUTE = 'data-throng-diagram-image';

/** The only shape a copied diagram image may take — the export profile admits this and nothing else. */
export const DIAGRAM_PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
