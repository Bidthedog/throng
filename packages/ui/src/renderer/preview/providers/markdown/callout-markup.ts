/**
 * The attribute names of throng's callout markup (075, contracts/callout-markup.md).
 *
 * A module of its own, importing nothing, so the eagerly loaded panel can name them (`callout-dom.ts` is reached
 * from `preview-panel.tsx`) without pulling the parser package, and with it markdown-it, out of the lazy
 * `preview` chunk.
 */
export const CALLOUT_ATTRIBUTE = 'data-callout';
export const CALLOUT_FOLD_ATTRIBUTE = 'data-callout-fold';
/** The type's colour role, from the registry, so the stylesheet styles seven roles and never a list of types (FR-019a). */
export const CALLOUT_ROLE_ATTRIBUTE = 'data-callout-role';
export const CALLOUT_TITLE_ATTRIBUTE = 'data-callout-title';
export const CALLOUT_TITLE_TEXT_ATTRIBUTE = 'data-callout-title-text';
export const CALLOUT_ICON_ATTRIBUTE = 'data-callout-icon';
export const CALLOUT_BODY_ATTRIBUTE = 'data-callout-body';
