# Local implementation and staged rollout

Production has not been deployed, restarted, load-tested again or mutated by this implementation task. Commit and push follow local validation and review; deployment is a separate manual action while Dokploy Autodeploy is off.

## Compatibility

- Default APK uses the existing production API and legacy media URLs. `--dart-define=PROTECTED_PLAYBACK=true` is an opt-in build for the new backend only; a session error never falls back to a public URL.
- Set `BACKEND_BASE_URL` at APK build time to target staging. The default remains the current production domain.
- Public images can use `PUBLIC_MEDIA_BASE_URL`; existing stored URLs remain valid. Videos continue through the proxy unless an authorized private-delivery integration is supplied.
- New clients request `limit=100` and follow `nextCursor` for entitlements. Legacy calls without pagination parameters retain complete responses. Remove the legacy unbounded path only after installed clients migrate.
- Payments require a stable existing `paymentId`; current checkout already supplies this. Server pricing uses stored course prices, course-scoped percentage coupons and the app's existing proportional GST allocation. Client totals outside one paise are rejected with 409, not silently charged.
- Merge the supplied Firestore index definitions into the project's authoritative index configuration. No indexes or rules have been deployed. Emulator tests do not prove production index availability.

## Protected playback release gates

1. Audit course/video document mappings and legacy storage URLs in staging. The session endpoint loads the video document by ID and checks its course binding and user entitlement (or enabled admin profile).
2. Set a random shared `PLAYBACK_SECRET` (32+ characters), `APP_BASE_URL`, and `PROTECTED_PLAYBACK=true` on the new backend. Public `/media/public/videos/...` requests are denied, including encoded-prefix variants. Manifests and segments use a signed path scope and check access at request time.
3. Verify the bucket/origin is private and cannot bypass the proxy. This local patch cannot alter existing Spaces ACLs or firewall/CDN settings. Firebase Storage/Cloudinary legacy videos need a mapped migration before enforcement; the endpoint rejects unmapped origins.
4. Test the protected APK, seeking, adaptive playback, expiry/reinitialization, course revocation and all supported client types. Update web/iOS clients before enforcement; their release artifacts were not requested here.
5. Do not enable enforcement on production while old installed clients still require public video paths. Explicitly schedule that transition. Do not describe legacy mode as protected.

Spaces built-in CDN does not cache presigned requests. The delivered CDN URL support is for public images; selecting/configuring a private video edge provider and validating its origin protection remain external rollout work. No promise of 1,000-viewer capacity follows from this code.

## Resources and monitoring

- Compose limits are proposed KVM4 budgets, not measured optimal values: API 2 GiB/1 CPU each; encoder 4 GiB/1.5 CPUs; Redis 1 GiB (768 MiB noeviction limit); small workers 512 MiB each. The host also runs Dokploy/Postgres/Traefik and requires headroom. CPU limits can sum above four because they are ceilings, not reservations.
- Keep FFmpeg concurrency one. Aligned 30fps keyframes, measured rendition metadata, source-size-aware scaling and publish-manifest-last ordering are implemented. Original object keys are timestamped; retries reuse that upload's output prefix, and processed jobs are skipped. This is not bulk re-encoding or deletion of existing videos.
- `/health/` is process liveness. `/health/ready` probes Redis, Firestore and storage with bounded response deadlines and a ten-second probe cache. Underlying Firestore RPCs may outlive the HTTP deadline; include them in observability.
- `/health/metrics` requires a separate `METRICS_TOKEN`; metric labels use route templates, not user IDs or playback tokens. It provides counts/sums/maxima; histogram percentiles remain measured by the test harness or external telemetry.
- Server manager samples host `/proc` counters and available memory through a read-only mount, alerts after three consecutive threshold samples, and emits recovery notifications. SMTP failures do not consume a successful-delivery cooldown. No Docker socket or automatic restart privilege is granted.
- An external observer is still required for whole-host outage alerts. SMTP delivery and external uptime integration need staging/live verification. Do not use a same-host green process check as evidence of disaster recovery.
- Enable `RATE_LIMIT_ENABLED` only after configuring exact trusted proxy CIDRs and validating client IP handling. Limits are shared in queue Redis; cache uses a separate optional Redis URL and never changes queue eviction policy. Admission returns 503 if its Redis dependency is unavailable.
- Keep `STORAGE_KEEP_ALIVE=false` for the compatibility rollout. Test `true` in staging against stale sockets before promoting. Socket count remains bounded.

## Reliability details and limits

- Uploaded-media records and pending video outbox entries are stored in the same Firestore transaction. The background worker dispatches pending work; queue IDs and completed-media state prevent duplicate conversion effects. Repeated upload completion preserves processed metadata and never downgrades it to processing.
- The background worker supports `dispatch-outbox`; the bucket worker supports non-destructive `verify-object`. Unknown jobs fail instead of falsely succeeding. No automatic deletion job was added.
- Provider order creation cannot be atomically committed with Firestore. An ambiguous Razorpay timeout leaves the deterministic reservation in `creating`. Reconcile the provider receipt with that reservation before retrying; never blindly create a second order. A reconciliation dashboard/automatic external financial action is not implemented.
- Firestore security rules must independently prevent mobile clients from granting their own payments/entitlements. Backend ownership tests do not certify existing client-write rules; review those rules before production release. Existing app direct Firestore reads remain outside backend API throughput testing.
- Cache is optional and currently applied to profile reads only. Authorization reads stay fresh, avoiding an unverified refund/revocation cache window. Profile updates invalidate before and after the transaction.

## Local validation

Use Node 22 for the runtime image. Unit tests mock cloud clients; integration tests use only a `demo-` Firestore emulator and an explicitly local authenticated Redis instance.

```
npm ci
npm run check
npm test
npm run build
docker compose -f docker-compose.test.yml up -d
```

Run the cached Firestore emulator on 127.0.0.1:19189 with project `demo-hacketh4u-local`, then set `RUN_REDIS_TESTS=true` and `RUN_FIRESTORE_TESTS=true` for integration tests. Never point tests at production. Test-only resources are isolated and disposable; this task retains their data rather than issuing production cleanup actions.

## Deployment and rollback (not executed)

For this release, the chosen path is a manual production deployment followed by the user's installed-APK checks. Before clicking Deploy, retain the prior commit/image/configuration, verify required query indexes are ready, and keep protected playback, rate limiting and storage keep-alive disabled. Use Deploy, never Fresh Volumes. No reset, migration, re-encoding or object-cleanup script is part of deployment. Normal authenticated app actions may update their own profile/token, progress and purchase state.

After deployment, verify both API replicas, readiness, image loading, video start/seek/quality changes, existing course access and payment history. Stop promotion if these fail and restore the prior image/configuration without deleting storage or databases. Confirm mobile acceptance before preparing the Play Store release. The optional protected-playback transition and SMTP/outage verification remain separate gates; keep enforcement off until all supported clients and origins are ready. Rolling back protected playback must not inadvertently reopen paid content.

Only then run production read-only stages 25, 50, 100, 250, 500, 1000, 1250 from a capable external generator. Stop at HTTP errors, latency budgets, 75% host pressure, 90% generator pressure, missing telemetry, customer impact or transfer budget. Passing one minute is not a sustained capacity claim.
