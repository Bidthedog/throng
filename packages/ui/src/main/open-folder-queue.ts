/** Folders asked for from outside throng, held until the main window's renderer can take them (067 research D6). */
export class OpenFolderQueue {
  private held: string[] = [];
  private isReady = false;

  constructor(private readonly deliver: (absPath: string) => void) {}

  push(absPath: string): void {
    if (this.isReady) this.deliver(absPath);
    else this.held.push(absPath);
  }

  ready(): void {
    this.isReady = true;
    const pending = this.held;
    this.held = [];
    for (const absPath of pending) this.deliver(absPath);
  }
}
