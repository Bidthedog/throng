import { userInfo } from 'node:os';
import type { CurrentUser, IUserContext } from '@throng/core';

/**
 * `IUserContext` implementation backed by Node's `os.userInfo()` (research D6/D8).
 * `userInfo().username` is a cross-platform Node API, injected through the
 * abstraction for testability and to keep OS calls out of the core. The username
 * is a stable per-process identity used as the `owner_user` persistence key.
 *
 * Verified against the shared contract suite in
 * `@throng/core/testing` → `runUserContextContract`.
 */
export class NodeUserContext implements IUserContext {
  private readonly user: CurrentUser;

  constructor() {
    const { username } = userInfo();
    // Guard against an empty/odd username so the owner key is always usable.
    const name = username && username.trim().length > 0 ? username : 'throng-user';
    this.user = { userId: name, userName: name };
  }

  currentUser(): CurrentUser {
    return this.user;
  }
}
