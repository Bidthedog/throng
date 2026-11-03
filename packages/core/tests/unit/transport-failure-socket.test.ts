import { describe, expect, it } from 'vitest';
import { isTransportFailure } from '../../src/failure/cause.js';

describe('a socket in a failure message (062 FR-011)', () => {
  it('is the daemon being unreachable when the connect itself failed', () => {
    expect(isTransportFailure('connect ENOENT /run/user/1000/throng/throng.dev.daemon.sock')).toBe(true);
    expect(isTransportFailure('connect ECONNREFUSED /tmp/throng-1000/x.sock')).toBe(true);
  });

  it('is not, when a file merely has that name', () => {
    expect(isTransportFailure("EACCES: permission denied, open '/home/me/proj/docker.sock'")).toBe(false);
    expect(isTransportFailure('cannot reach /var/run/docker.sock')).toBe(false);
  });
});
