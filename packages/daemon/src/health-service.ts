import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectable } from 'inversify';
import { HEALTH_PING_METHOD, type HealthPongResult } from '@throng/ipc-contract';
import type { IElevationState } from '@throng/core';
import type { RpcRouter } from './rpc-router.js';

/** Build id stamped into dist/BUILD_ID by the build; identifies the running code. */
function readBuildId(): string {
  try {
    return readFileSync(fileURLToPath(new URL('./BUILD_ID', import.meta.url)), 'utf8').trim();
  } catch {
    return 'dev'; // not stamped (partial/tsc-only build) — treat as a stable id
  }
}

/**
 * Health/liveness method (`health.ping`, from 001). Captures the daemon start
 * time and answers with status/pid/startedAt/buildId. Registered into the
 * {@link RpcRouter} at composition time.
 */
@injectable()
export class HealthService {
  private readonly startedAt = new Date().toISOString();
  private readonly buildId = readBuildId();

  /** @param elevation reports the daemon's own integrity (FR-025b); omitted → unknown. */
  constructor(private readonly elevation?: IElevationState) {}

  get daemonStartedAt(): string {
    return this.startedAt;
  }

  register(router: RpcRouter): void {
    router.register(HEALTH_PING_METHOD, () => this.ping());
  }

  ping(): HealthPongResult {
    return {
      status: 'ok',
      daemonStartedAt: this.startedAt,
      pid: process.pid,
      buildId: this.buildId,
      elevated: this.elevation?.isElevated() ?? false,
    };
  }
}
