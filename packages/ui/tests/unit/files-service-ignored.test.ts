import { describe, expect, it } from 'vitest';
import type { IFileSystem, IgnoreOracle, IShellIntegration } from '@throng/core';
import { FilesService } from '../../src/main/files-service.js';

/**
 * 081 US8, contract `ignore-oracle.md` (IPC `throng:files:ignored`) — main asks the oracle about the active root only,
 * and only for paths inside it. Git's matching is proven by the platform-node integration test; this is the
 * confinement and the no-root answer.
 */

interface Asked {
  root: string;
  relPaths: readonly string[];
}

function service(answer: (relPaths: readonly string[]) => string[]): { svc: FilesService; asked: Asked[] } {
  const asked: Asked[] = [];
  const oracle: IgnoreOracle = {
    ignored: (root, relPaths) => {
      asked.push({ root, relPaths });
      return Promise.resolve(new Set(answer(relPaths)));
    },
  };
  const svc = new FilesService({} as IFileSystem, {} as IShellIntegration, oracle);
  return { svc, asked };
}

describe('FilesService.ignored', () => {
  it("answers the oracle's verdict for the active root", async () => {
    const { svc, asked } = service(() => ['build/', 'a.log']);
    svc.setRoot('/p/root');
    expect(await svc.ignored(['build/', 'a.log', 'src/'])).toEqual({ ignored: ['build/', 'a.log'] });
    expect(asked).toEqual([{ root: '/p/root', relPaths: ['build/', 'a.log', 'src/'] }]);
  });

  it('answers empty with no active root, without asking', async () => {
    const { svc, asked } = service(() => ['x']);
    expect(await svc.ignored(['x'])).toEqual({ ignored: [] });
    expect(asked).toEqual([]);
  });

  it('never passes on a path that leaves the root', async () => {
    const { svc, asked } = service((relPaths) => [...relPaths]);
    svc.setRoot('/p/root');
    const answer = await svc.ignored(['ok.txt', '../out.txt', 'a/../../b', '/etc/passwd', 'C:/x', 'C:\\x', '']);
    expect(answer).toEqual({ ignored: ['ok.txt'] });
    expect(asked[0].relPaths).toEqual(['ok.txt']);
  });

  it('answers empty without an oracle', async () => {
    const svc = new FilesService({} as IFileSystem, {} as IShellIntegration);
    svc.setRoot('/p/root');
    expect(await svc.ignored(['a'])).toEqual({ ignored: [] });
  });
});
