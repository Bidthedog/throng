import type { FileManagerRegistration, IFileManagerRegistration } from '../abstractions/file-manager-registration.js';

/** An in-memory registration: starts in `state` and, unless that is fixed by the install, follows `setEnabled`. */
export class FakeFileManagerRegistration implements IFileManagerRegistration {
  constructor(private state: FileManagerRegistration = { state: 'on' }) {}

  async status(): Promise<FileManagerRegistration> {
    return this.state;
  }

  async setEnabled(on: boolean): Promise<FileManagerRegistration> {
    if (this.state.state === 'on' || this.state.state === 'off') this.state = { state: on ? 'on' : 'off' };
    return this.state;
  }
}
