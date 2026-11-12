/**
 * Whether the OS file manager offers "Open as throng project" (067 FR-034). The registration itself is the state:
 * there is no setting that could disagree with it.
 */
export type FileManagerRegistration =
  | { readonly state: 'on' | 'off' }
  /** A machine-wide install registered it, which only an elevated process could change. */
  | { readonly state: 'machine-wide'; readonly reason: string }
  /** A portable or archive build, which registers nothing (FR-036). */
  | { readonly state: 'unavailable'; readonly reason: string };

export interface IFileManagerRegistration {
  status(): Promise<FileManagerRegistration>;
  /** Turn the item on or off for this user. Answers the state afterwards; never claims a change it could not make. */
  setEnabled(on: boolean): Promise<FileManagerRegistration>;
}
