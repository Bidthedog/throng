import type {
  SubWorkspaceMetaDto,
  SubworkspaceListResult,
  SubworkspaceOkResult,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Typed renderer client for the `subworkspace.*` daemon methods (003 / US7). The
 * management surface for first-class sub-workspaces. Detach (workspace persistence) makes one from
 * existing content; `create` (067 FR-082) makes an empty one, unloaded, from the panel itself.
 */
export class SubWorkspacesClient {
  constructor(private readonly bridge: ThrongBridge) {}

  async list(): Promise<SubWorkspaceMetaDto[]> {
    const result = await this.bridge.invoke<SubworkspaceListResult>('subworkspace.list', {});
    return result.subWorkspaces;
  }

  /** 067 FR-083 — a new sub-workspace holding one untyped panel it owns; no window is opened. */
  create(): Promise<SubWorkspaceMetaDto> {
    return this.bridge.invoke<SubWorkspaceMetaDto>('subworkspace.create', {});
  }

  rename(id: string, name: string): Promise<SubworkspaceOkResult> {
    return this.bridge.invoke<SubworkspaceOkResult>('subworkspace.rename', { id, name });
  }

  recolour(id: string, colour: string): Promise<SubworkspaceOkResult> {
    return this.bridge.invoke<SubworkspaceOkResult>('subworkspace.recolour', { id, colour });
  }

  remove(id: string): Promise<SubworkspaceOkResult> {
    return this.bridge.invoke<SubworkspaceOkResult>('subworkspace.delete', { id });
  }

  reorder(orderedIds: string[]): Promise<SubworkspaceOkResult> {
    return this.bridge.invoke<SubworkspaceOkResult>('subworkspace.reorder', { orderedIds });
  }
}
