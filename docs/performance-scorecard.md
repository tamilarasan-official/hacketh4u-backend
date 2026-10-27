# Evidence-based scorecard

No post-change live server score is assigned by local tests. Keep health, performance, correctness and evidence coverage separate.

Health / reliability: readiness and availability 25; resource headroom under representative load 25; queue/data/recovery behavior 25; monitoring and alert delivery 25.

Performance: video delivery and real playback 40; image delivery 15; authenticated API performance 25; sustained throughput/resource efficiency 20.

Each category has five checks of equal weight. Award a check only with a linked artifact for the tested commit/environment. Missing evidence is Unknown, not Pass or Fail. Publish earned points, tested possible points and unknown possible points separately. Do not rescale a partially tested score to 100. Any authorization bypass, corrupted media, or payment inconsistency blocks release regardless of points.

Health checks:
- Readiness: process liveness; Redis loss; Firestore loss; storage loss; recovery without restart loops.
- Resources: host CPU below 75%; available-memory usage below 75%; disk free above 20%; measured network headroom above 25%; generator below 90% CPU/RAM.
- Reliability: concurrent payment completion; outbox recovery; duplicate jobs; graceful shutdown; no customer-visible regression during representative soak.
- Monitoring: accurate CPU/memory; sustained alert; actual SMTP delivery; recovery alert delivery; independent host outage observer.

Performance checks:
- Video: valid/complete HLS; segment download p95 below half its media duration; measured startup p95 below 3 seconds; rebuffer ratio below 1%; seeking/quality switch succeeds in a real player.
- Images: no unexpected HTTP failures; p95 below 1 second; correct cache behavior; byte integrity; repeatable results over a ten-minute hold.
- APIs: authorized read correctness; p95 below 500ms; p99 below 1 second; unexpected failures below 0.1%; pagination/limits hold under representative load. External checkout calls have a separately recorded provider-dependent budget.
- Throughput: complete intended hold; resource headroom maintained; no generator saturation; ten-minute repeatability; request mix/bytes and concurrent viewer count recorded.

These are provisional engineering targets, not a contractual SLA. Freeze them before comparative tests; never change thresholds merely to manufacture a pass. Production protection may stop earlier (first unexpected HTTP failure). Record stop reason and do not call the highest attempted stage a passing capacity.

The report must name the tested code hash, configuration, generator, geography, workload, duration, sample counts, latency percentiles, observed RPS/RPM, media bytes, CPU/RAM/network, queue age and unknowns. Recommend scaling from the observed bottleneck and repeatable sustainable load, not from KVM plan name or an idle CPU percentage.
