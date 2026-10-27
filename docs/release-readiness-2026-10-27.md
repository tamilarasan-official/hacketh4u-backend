# Backend release review - 27 October 2026

This is the compatibility release reviewed against base commit `b436ec993d930cc30771fea0999c7ae150d73fe9`. Dokploy Autodeploy is off; pushing the code and deploying it are separate steps. The installed APK remains compatible with the default public media mode.

## Reviewed changes

- Media/API: bounded storage connections, abort on client disconnect, byte ranges, cache headers, optional signed playback, cursor pagination, optional profile cache and shared rate limiting.
- Uploads/workers: transactional upload/outbox creation, deterministic queue IDs, completed-job checks, bounded FFmpeg processing, accurate HLS metadata and manifest-last publication. Completion retries now preserve existing processed metadata instead of writing processing state over it.
- Payments: prices validated against stored course/coupon values, stable order reservations, ownership checks and transactional duplicate-safe entitlement grants. Ambiguous provider order creation still needs reconciliation.
- Operations: Node 22 production image, production-only dependencies, resource limits, preserved Redis volume, worker health, host resource monitoring, readiness and authenticated metrics.
- Validation/documentation: isolated tests, sample optional settings, proposed Firestore indexes, rollout guide and evidence-based scorecard.

## Validation of this release

- TypeScript no-emit check: passed after correcting the upload-helper type.
- Node 22 Docker production build: passed, including TypeScript compilation and production dependency installation.
- Backend suite: **48 tests passed in 8 files; no skipped tests**. Local authenticated Redis and the `demo-hacketh4u-local` Firestore emulator were enabled. Concurrency tests exercise transaction retries.
- Real FFmpeg runtime smoke: passed using an eight-second 320x180 fixture, two renditions, four segments and seven mocked storage uploads. No upscaling; master published last; zero external storage calls.
- Nginx configuration test and Compose syntax validation passed. Compose validation used `--no-env-resolution`; production environment values were not loaded or validated. Git whitespace and staged credential-pattern/artifact checks passed.
- Production dependency audit: no high or critical findings; eight moderate transitive findings remain. No forced dependency downgrade was applied.
- Test artifacts are local under `C:/hacketh4u/output/local-improvements/prepush-*`; credentials and generated media are not committed.

## Data boundary and deployment

This work did not connect to or write production Firestore/Spaces, run reset scripts, delete existing objects, restart the VPS, or invoke Dokploy deployment. There is no startup migration or bulk data rewrite. Existing authenticated app operations, including purchase grants and upload processing, still perform their intended writes. Existing delete APIs are not invoked by deployment or these tests; ownership checks now restrict them.

Keep `PROTECTED_PLAYBACK=false`, `RATE_LIMIT_ENABLED=false` and `STORAGE_KEEP_ALIVE=false` for the initial rollout. No new optional secret is required in that mode. Check query-index readiness separately; emulator success cannot prove deployed indexes. Preserve the prior image and environment, use **Deploy**, and never use **Fresh Volumes** for this release.

After manual deployment, check both API replicas, readiness, existing images, video startup/seeking/quality changes, course access and payment history on the installed APK. Play Store publication follows mobile acceptance. SMTP delivery, whole-host failure detection, protected-origin enforcement and sustained production capacity remain unverified by local tests. A 1,000-viewer capacity or live server health score cannot be inferred from these results.
