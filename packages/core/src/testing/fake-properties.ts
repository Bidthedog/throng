import type { IFileAttributes } from '../abstractions/file-attributes.js';
import type { IOsPropertiesDialog } from '../abstractions/os-properties-dialog.js';
import type { IFileAccessInfo } from '../abstractions/file-access-info.js';
import type { FileAccess } from '../explorer/properties.js';
import type { ShellActionResult } from '../abstractions/shell-integration.js';
import type { FileAttributes } from '../explorer/properties.js';

export class FakeFileAttributes implements IFileAttributes {
  constructor(private readonly value: FileAttributes = { readOnly: false, hidden: false, system: false, archive: false, junction: false }) {}

  async read(): Promise<FileAttributes> {
    return this.value;
  }
}

export class FakeOsPropertiesDialog implements IOsPropertiesDialog {
  readonly available = true;
  readonly shown: string[] = [];

  async show(path: string): Promise<ShellActionResult> {
    this.shown.push(path);
    return { ok: true };
  }
}

/** Answers with whatever the test supplied. */
export class FakeFileAccessInfo implements IFileAccessInfo {
  constructor(private readonly access?: FileAccess) {}

  async read(): Promise<FileAccess | undefined> {
    return this.access;
  }
}
