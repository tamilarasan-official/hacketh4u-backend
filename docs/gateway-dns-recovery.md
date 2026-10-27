# Gateway recovery after API recreation

The 28 October 2026 rollout built successfully and both APIs became healthy, but the existing Nginx gateway kept its old upstream addresses. Read-only production inspection confirmed successful direct requests to both current API addresses and gateway 502 errors connecting to the previous addresses. The server-manager remained Created because it depends on a healthy gateway. This was a routing failure, not a failed TypeScript build or SMTP dependency.

## Immediate recovery, when authorized

From the server's SSH terminal, validate the mounted configuration and gracefully reload only Nginx:

```sh
docker exec hackethos4ubackend-masterbackend-1ywrnz-backend-1 nginx -t && docker exec hackethos4ubackend-masterbackend-1ywrnz-backend-1 nginx -s reload
```

This refreshes the current static upstream addresses without restarting the API or Redis containers. It does not create, edit or delete Firestore documents or Spaces objects. It is a production configuration action and is separate from read-only inspection. Normal application/worker activity continues.

Check gateway health and public readiness afterward. This reload alone does not start the server-manager left in Created state by the failed Compose operation; the subsequent normal deployment should complete the service startup.

## Permanent fix

The upstream now has shared memory (`zone`), Docker's embedded DNS resolver (`127.0.0.11`, five-second validity) and `resolve` on each API hostname. Nginx can discover new API addresses without a reload. The image is pinned to `nginx:1.27.5-alpine`, matching the version inspected in production and supporting open-source upstream re-resolution (introduced in 1.27.3).

Changing the Compose image reference from `nginx:1.27-alpine` causes the first normal deployment of this fix to recreate the gateway and load the new configuration. Keep the tested environment settings, deploy normally, and do not use Fresh Volumes, remove Redis volumes, or run data migrations. A gateway replacement can briefly interrupt connections; it is not a zero-downtime guarantee. For future changes to a bind-mounted Nginx config, explicitly ensure the gateway loads the new file rather than assuming a file-content change recreates the container.

After deployment, verify both APIs, gateway, queue Redis, profile cache, three workers and server-manager. Run `scripts/verify-rollout.cjs` in both API containers and check the public HTTPS health/readiness paths before resuming mobile acceptance.

## Local regression

Run `docker pull nginx:1.27.5-alpine` then `python tests/gateway-dns-smoke.py`. The test uses an isolated disposable local Docker network, no published ports, no production credentials and no data volumes. It reproduces the old gateway's failure after both API IPs change, verifies the fixed gateway reaches both replacement APIs without changing its container ID/start time, checks Compose configuration and Nginx syntax, and cleans up only its own test containers/network.

Reference: https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve
