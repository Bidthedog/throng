import type {
  SubWorkspaceMetaDto,
  SubworkspaceListResult,
  SubworkspaceOkResult,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Typed renderer client for the `subworkspace.*` daemon methods (003 / US7). The
 * management surface for first-class sub-workspaces; creation happens via detach
 * (workspace persistence), not here.
 */
export class SubWorkspacesClient {
  constructor(private readonly bridge: ThrongBridge) {}

  async list(): Promise<SubWorkspaceMetaDto[]> {
    const result = await this.bridge.invoke<SubworkspaceListResult>('subworkspace.list', {});
    return result.subWorkspaces;
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
