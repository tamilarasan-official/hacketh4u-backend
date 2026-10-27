# Optional backend feature rollout

This release adds activation controls and local validation. It does not activate production flags, change Firestore documents/indexes/rules, change Spaces objects/ACLs, or publish an app. The previously deployed compatibility commit was `44f64df74a0b3e59fa5e8cfe5a91a0ef679e68ac`; record the actual current commit/image before promotion. Dokploy Autodeploy must remain off until manual deployment is intended.

## What is ready in code

| Area | Implementation | Remaining production gate |
|---|---|---|
| Profile cache | Optional private `profile-cache` Redis service, disposable/evictable, separate password and no host port. Cross-replica generation checks reject stale in-flight publications; errors fall back to Firestore. | Set profile/URL/password, see cache hits on both replicas, and verify normal profile update invalidation. |
| Metrics | Constant-time bearer-token comparison, private feature/cache/instance state; authenticated proxy diagnostics. | Generate token, test correct/missing/wrong tokens on each replica and through ingress. |
| Rate limits | Shared atomic Redis counters, separate coarse API-IP/media-IP budgets and authenticated user budget. Firebase verifies identity before applying user budget. | Verify real proxy chain, spoof resistance, independent clients, shared-Wi-Fi playback and realistic budgets. |
| Playback | Session availability separated from public-video enforcement; optional tester UID allowlist. Signed paths recheck course access for each object request. | Protected pilot APK, entitlement/seek/expiry/revocation acceptance, private origin and all-client compatibility. |
| Images | New URLs can use CDN. Existing API image URLs can redirect reversibly. Dedicated image-only origin never redirects and rejects video paths. | Choose/configure CDN/DNS/TLS/origin path, validate cache hits, then activate redirects. |
| Storage connections | Bounded read-only A/B probe included; default remains fresh connections. | Actual Spaces repeated/idle tests and observation; keeping reuse disabled is acceptable. |

The cache is an optimization, not an authorization store. Profiles use a 15-second TTL. Backend profile writes invalidate before/after their transaction. Direct client/admin Firestore changes bypass that invalidation and can remain visible from cache for up to the TTL. Cache failure may add its bounded command timeout before falling back. Do not reuse queue Redis for this cache: queue eviction must stay `noeviction` with its existing persistent volume.

## Preparation and first deployment

1. Preserve the currently deployed commit/image reference and a private copy of Dokploy environment. Confirm the four previously inspected Firestore indexes remain Enabled. This release introduces no additional query indexes.
2. Generate secrets locally: `node scripts/generate-rollout-secrets.cjs`. The ignored `.env.rollout.local` contains separate 256-bit metrics/signing/cache values. It refuses to overwrite an existing file and does not print values. Copy only the selected keys into Dokploy Environment; never put them in Git, chat, screenshots or the APK. Regenerating the playback secret invalidates active signed sessions.
3. First batch: add `METRICS_TOKEN`, `CACHE_REDIS_PASSWORD`, `CACHE_REDIS_URL` from that private file and `COMPOSE_PROFILES=cache`. Preserve the existing `REDIS_URL`, `REDIS_PASSWORD` and `redis-data` volume. The Compose profile starts the dedicated cache; API startup does not depend on it because cache failure is tolerated.
4. Retain the following compatibility flags for this first batch. Omit `PUBLIC_MEDIA_BASE_URL` until its endpoint works; an empty value is not equivalent to an omitted optional URL.

```dotenv
PROTECTED_PLAYBACK=false
PLAYBACK_SESSIONS_ENABLED=false
PLAYBACK_TEST_USER_IDS=
RATE_LIMIT_ENABLED=false
IMAGE_CDN_REDIRECT_ENABLED=false
STORAGE_KEEP_ALIVE=false
STORAGE_MAX_SOCKETS=32
RATE_LIMIT_PER_MINUTE=240
RATE_LIMIT_IP_PER_MINUTE=3000
RATE_LIMIT_MEDIA_PER_MINUTE=6000
```

5. Save Environment with Create Environment File enabled. Use normal **Deploy** for the tested commit. Do not use Fresh Volumes, reset scripts, cleanup jobs, volume removal, data migrations or object re-encoding. Normal worker processing of already-pending uploads remains possible; deployment is not a promise that ordinary app activity freezes.
6. Expect nine application containers when the optional cache is enabled (the previous eight plus `profile-cache`). Verify both APIs, gateway, queue Redis, cache, three workers and server-manager. Preserve the rollback image; Compose on one host is not a zero-downtime or whole-host failover guarantee.

## Read-only checks after every batch

The runtime image includes `scripts/verify-rollout.cjs`. Inside each API container, run:

```sh
VERIFY_BASE_URL=http://127.0.0.1:3000 node scripts/verify-rollout.cjs
```

It reads existing container `METRICS_TOKEN`, checks liveness/readiness, missing/wrong/correct metrics authorization, and compares normal versus spoofed forwarded headers. It never calls login, payment, upload, deletion or progress endpoints. Optional `VERIFY_IMAGE_KEY` selects one existing public-image key for HEAD checks. Set `VERIFY_IMAGE_REDIRECT=true` only after redirects are enabled. Direct loopback diagnostics check local behavior; the external ingress test below is still mandatory.

From a separate client, run the same script with `VERIFY_BASE_URL=https://api.hackethos4u.com` and the token supplied privately to the process. Expected: health/ready 200, unauthorized metrics 404, authorized metrics 200 with no secrets, expected feature flags and cache configured/ready true. Metrics are per process; inspect both API containers. Counters reset on restart. They contain counts/total/max latency, not p95 histograms or a server capacity score.

Have the installed app read its profile repeatedly. Cache hit counters should increase; a normal profile/token update through the API should increment invalidations and its next read should reflect the change. The local tests cover an unavailable cache and concurrent invalidation; do not stop production cache merely to repeat that failure test. Look for cache errors/Firestore load while observing normal traffic.

As in the previous deployment check: inspect container health/restarts/OOM, host CPU/memory/disk, readiness on both replicas, existing image GET/HEAD, HLS master plus 480p/720p playlists, one bounded segment range (206), mobile start/seek/quality switching, entitlement list and payment history. Use existing data; no synthetic payment or progress writes. Normal mobile testing may update its own profile/progress, as authorized. No data deletion or bulk rewriting is part of verification.

## Rate limiting batch

1. Keep `RATE_LIMIT_ENABLED=false` while configuring `TRUSTED_PROXY_CIDRS`. Inspect the actual Nginx and Traefik peer addresses/networks with read-only Docker inspection. Trust only the known proxy hops. Explicit IP/CIDR entries are required; never use `true`, all-address ranges, or an arbitrary hop count. Container IPs can change after recreation; use a deliberately stable network arrangement or revalidate after every deploy. Do not copy historical container IPs blindly.
2. Through the public HTTPS ingress, call protected `/health/diagnostics` from Wi-Fi and mobile data. `clientIp` must match each real egress IP and differ between networks. Sending a forged `X-Forwarded-For: 198.51.100.66` must not replace it. If the result is a Docker gateway/proxy IP, or changes to the forged IP, fix the trust chain before enabling limits. The script's equality check alone cannot prove correct client attribution.
3. Budgets are fixed one-minute windows: 240 authenticated requests/user, 3000 coarse API requests/IP and 6000 media reads/IP. They are starting settings, not a capacity guarantee. A fixed window can allow a burst spanning a boundary. All clients behind one NAT still share its coarse IP budget. HLS segments/manifests and image-origin reads share the media budget; a CDN origin may aggregate many users onto one IP. Tune from measured request patterns and CDN misses. Health/readiness/metrics/diagnostics and POST Razorpay webhook ingress are exempt; the real webhook handler still verifies its signature.
4. Enable `RATE_LIMIT_ENABLED=true` in a separate deploy. Verify user A's usage does not consume user B's authenticated quota, while requests alternating between replicas share A's counter. Confirm 429 with Retry-After at the chosen threshold in an isolated/local test. Do not lower all production users' limit or flood live APIs just to force 429. Controlled production boundary tests need a test account, agreed request cap and abort thresholds. Admission fails with 503 if queue Redis is unavailable.
5. Roll back unexpected customer 429/503 by setting `RATE_LIMIT_ENABLED=false` and redeploying, preserving the proxy configuration and queue data.

## Protected playback pilot, then enforcement

Set the separate generated `PLAYBACK_SECRET` on both APIs. Set `PLAYBACK_SESSIONS_ENABLED=true`, `PLAYBACK_TEST_USER_IDS` to your test UID(s), and **keep `PROTECTED_PLAYBACK=false`**. Existing installed clients continue public playback; only testers may create signed sessions. This pilot does not make the legacy public route private.

Build a separate test APK using the existing frontend switch `--dart-define=PROTECTED_PLAYBACK=true`. The currently installed default APK does not exercise signed playback. For an entitled test account, check video selection, startup, 480p/720p switching, seeking, background/resume and replay. An existing unentitled account must be denied. Tampered/expired tokens and paths outside the signed video must fail. Local tests cover access revocation without modifying production entitlement documents; do not revoke a real customer's access for a test.

The backend returns `expiresAt`; the current Flutter session helper obtains a URL when initializing playback and does not schedule proactive renewal. Therefore uninterrupted playback beyond token lifetime is still a **client release gate**: test expiry/reinitialization, implement automatic refresh if the required UX needs it, and validate before global enforcement. Token validity is not DRM; shared valid URLs work within their scope until expiry/revocation. Every signed object checks entitlement in Firestore, so measure its extra read load separately from the previous public-playback load test.

Enforce only after Android/web/iOS/other supported clients are compatible, legacy video mappings are verified and direct origin URLs cannot bypass access checks. A HEAD 403 on one Spaces object is insufficient to establish whole-origin privacy. No bucket ACL change or migration is included here. Remove the tester allowlist, leave sessions enabled and then set `PROTECTED_PLAYBACK=true`. Startup refuses enforcement with a tester allowlist. Do not publish a protected-only APK unless the session backend is already healthy.

Pilot rollback: disable `PLAYBACK_SESSIONS_ENABLED` while enforcement remains false; legacy apps continue working but the pilot APK stops. After enforcement, rollback must preserve protection (restore the last working protected release/configuration); do not silently reopen public paid video access.

## Image delivery batch

Choose a pull CDN with HTTPS and configure its origin as the API's `/media/image-origin/` path. For example, a request to `https://images.example/course-thumbnails/u/a` must fetch `https://api.hackethos4u.com/media/image-origin/course-thumbnails/u/a`. Preserve the object-key suffix and support GET/HEAD, Range and conditional requests. Do not configure the origin as `/media/public/` once redirects are enabled, which would loop.

Allowed folders: user-profiles, course-thumbnails, mentor-profiles, banner-images, video-thumbnails. Video and certificate paths are not served by this origin. The route is intentionally public for these existing public-image folders; do not put private files in them. It uses existing backend storage credentials, so the whole Spaces bucket need not be made public. Do not override `private/no-store` policies globally or route protected video through this image CDN.

Before setting `PUBLIC_MEDIA_BASE_URL`, compare bytes/content type/ETag from representative existing images through origin and CDN. Check cache MISS then HIT/Age, bounded ranges and TLS, and verify the CDN cannot fetch `/videos/...`. A cache hit is proved by CDN response headers/logs, not by a successful 200 alone. Set `PUBLIC_MEDIA_BASE_URL` only after it passes; this immediately affects URLs returned for subsequent image uploads. Then independently enable `IMAGE_CDN_REDIRECT_ENABLED=true` to route existing API image URLs through the CDN with 307/no-store. No Firestore rewrite occurs. Existing URLs on old API hostnames only benefit if those hostnames still reach this backend; they need a separate DNS/routing check.

Rollback redirects with the flag off. URLs already saved with the CDN host will still use that host, so keep CDN DNS/origin operational during rollback. Removing the base setting only affects subsequently generated URLs. Images currently have long immutable caching and timestamped keys; overwriting the same key needs an explicit CDN invalidation strategy. No purge or object overwrite is part of this rollout.

## Storage keep-alive and alerts

Leave `STORAGE_KEEP_ALIVE=false`. Inside an API container, set `STORAGE_PROBE_KEY` to one existing object key and run `node scripts/storage-connection-probe.cjs`. This isolated process uses container credentials without printing them, sends twelve signed HEAD requests sequentially (six per mode), includes a 30-second idle gap in each mode and reports timings/connection counts/errors. It does not change the running API's setting or objects. Repeat during representative conditions before considering a one-variable deploy enabling reuse. Twelve HEADs are a diagnostic, not a streaming benchmark. Compare bounded streaming/seek requests and longer idle periods as a later step; restore false immediately if timeouts recur.

Resource sampling is implemented but real `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ALERT_EMAIL_TO` are still operational inputs. Replace placeholders privately, verify provider authentication and send an agreed test alert before relying on email. Preserve threshold 75%, 30-second interval and three sustained samples unless deliberately tuned. An independent external uptime monitor is still required for complete host failure. Docker restart policy recovers exited processes; an unhealthy container alone is not automatically restarted by this implementation, and same-host replicas do not recover a dead VPS. No privileged automatic restarter was added.

## Promotion evidence and app release

Record each deployed commit/config batch, both replica states, HTTP results, cache counters, CPU/memory/disk and mobile acceptance. Pause promotion for any readiness failure, unexpected 5xx/429, recurring storage timeout, restart/OOM or sustained resource pressure above 75%. Observe normal traffic between batches; a short green smoke check is not a capacity result. No destructive stress test is required to activate these features.

Only after backend gates and the correct APK mode pass should a fresh release AAB be built and checked for version/signing/API target. Do not reuse the older AAB already in the frontend build directory. A sustained externally generated load test with realistic playback pacing, error/latency/resource/transfer abort limits is a separate operation. This patch does not establish maximum concurrent users, RPS or a numerical production health score.

Technical references: [Express proxy trust](https://expressjs.com/en/guide/behind-proxies.html), [Spaces CDN setup](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/), [Spaces limits, including presigned CDN caching](https://docs.digitalocean.com/products/spaces/details/limits/).
