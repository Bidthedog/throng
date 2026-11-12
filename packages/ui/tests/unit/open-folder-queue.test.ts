import { describe, expect, it } from 'vitest';
import { OpenFolderQueue } from '../../src/main/open-folder-queue.js';

function setup() {
  const sent: string[] = [];
  return { sent, queue: new OpenFolderQueue((path) => sent.push(path)) };
}

describe('OpenFolderQueue (067 FR-025, edge case: several at once)', () => {
  it('holds requests until the renderer is ready, then delivers them in arrival order', () => {
    const { sent, queue } = setup();
    queue.push('/a');
    queue.push('/b');
    expect(sent).toEqual([]);
    queue.ready();
    expect(sent).toEqual(['/a', '/b']);
  });

  it('delivers at once after that, including the launch that started throng', () => {
    const { sent, queue } = setup();
    queue.ready();
    queue.push('/c');
    expect(sent).toEqual(['/c']);
  });

  it('delivers the held requests only once', () => {
    const { sent, queue } = setup();
    queue.push('/a');
    queue.ready();
    queue.ready();
    expect(sent).toEqual(['/a']);
  });
});
