import { describe, it, expect } from 'vitest';
import { runUserContextContract } from '@throng/core/testing';
import { NodeUserContext } from '@throng/platform-windows';

describe('NodeUserContext', () => {
  it('satisfies the shared IUserContext contract', () => {
    expect(() => runUserContextContract(() => new NodeUserContext())).not.toThrow();
  });

  it('reports a stable, non-empty current OS user', () => {
    const subject = new NodeUserContext();
    const user = subject.currentUser();
    expect(user.userId.trim().length).toBeGreaterThan(0);
    expect(user.userName.trim().length).toBeGreaterThan(0);
    expect(subject.currentUser()).toEqual(user);
  });
});
