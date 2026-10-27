# Backend optional-feature validation — 27 October 2026

Scope: local backend code and rollout preparation, based on deployed compatibility commit `44f64df`. No production SSH commands, deployment, database writes, object operations or app publication were performed during this implementation batch.

| Check | Result | Boundary |
|---|---|---|
| TypeScript no-emit check | PASS | Current source |
| Vitest suite | 75/75 PASS, 13 files, zero skipped | Authenticated local queue/cache Redis and local `demo-hacketh4u-local` Firestore emulator |
| Node 22 production Docker build | PASS | Image `hacketh4u-rollout-local:20261027`; digest `sha256:49b6365ffbe71bfcc5b4aaada02615ff4732e33b9b09ff7ca8176019c0a64cb9` |
| Real FFmpeg runtime smoke | PASS | Eight-second local 320x180 fixture, two renditions, four segments, master published last; mocked storage, zero external calls |
| Nginx syntax | PASS | Local container with test host mappings |
| Compose configuration | PASS | Default eight services; nine with `COMPOSE_PROFILES=cache` loaded from an env file; production env not read |
| Exact cache startup command/health | PASS | Isolated local service healthy, no published ports, allkeys-lru, appendonly off, snapshots off; queue volume definition unchanged |
| Connection probe runtime | PASS | Isolated TLS fixture: twelve HEAD requests, six connections without reuse versus two with reuse, 30-second idle gap per mode |
| Read-only verification CLI | PASS | Local HTTP fixture: nine GET/HEAD checks, authorization and spoof comparison, no token output |
| Generated secrets | PASS | Separate 256-bit values, local private file ignored by Git and excluded from image context; values not reported |
| Dependency installation/audit output | 0 high/critical, 8 moderate | Existing transitive findings remain; no dependency changes in this patch |

New tests cover cross-replica cache hits/invalidation and stale in-flight loads, cache outage fallback, atomic admission counters across two real Redis connections, distinct client/user/media budgets, 429/Retry-After, fail-closed admission, verified identity, proxy spoof handling, protected metrics, CDN origin/redirect boundaries, public/signed playback coexistence, access revocation, token expiry/tampering/scope and unsafe configuration rejection.

The first TLS fixture run failed its first three handshakes because Docker's local clock lagged Windows by approximately 80 seconds and the newly generated certificate was not yet valid there. The fixture validity interval was corrected without changing host clocks; the repeated run passed. This is not evidence of a production Spaces fault or a reason to enable keep-alive there.

Detailed machine-readable test results remain local at `C:/hacketh4u/output/local-improvements/rollout-tests.json`; the connection-probe fixture result is in `rollout-probe-result.json`. Fixtures have no production credentials. Local tests write only to local emulator/test services.

Not proven by this report: live SMTP delivery, complete host failover, real CDN cache hits/DNS configuration, actual production proxy trust, signed-player expiry UX, private origin enforcement, or maximum concurrent viewers/RPS. See [the rollout guide](backend-feature-rollout.md) for activation order, acceptance checks, rollback and the remaining protected-APK compatibility gate. No numerical server health/capacity score is invented from local tests.
