// Read-only HTTP smoke test. Does not send login, payment, upload, deletion or progress requests.
async function main() {
  const base = new URL(process.env.VERIFY_BASE_URL || 'https://api.hackethos4u.com');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('Use HTTPS.');
  const results = [];
  async function check(name, path, expected, options = {}) {
    const start = Date.now();
    const response = await fetch(new URL(path, base), { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const entry = { name, status: response.status, ms: Date.now() - start, ok: expected.includes(response.status) };
    if (name.startsWith('diagnostics') && response.status === 200) entry.diagnostics = await response.json();
    else if (name === 'metrics-authorized' && response.status === 200) {
      const body = await response.json(); entry.features = body.features; entry.cache = body.cache; entry.instance = body.instance;
    } else await response.body?.cancel();
    results.push(entry); return entry;
  }
  await check('liveness', '/health/', [200]);
  await check('readiness', '/health/ready', [200]);
  await check('metrics-denied', '/health/metrics', [404]);
  await check('metrics-wrong-token', '/health/metrics', [404], { headers: { Authorization: 'Bearer invalid' } });
  if (process.env.METRICS_TOKEN) {
    const headers = { Authorization: `Bearer ${process.env.METRICS_TOKEN}` };
    await check('metrics-authorized', '/health/metrics', [200], { headers });
    const normal = await check('diagnostics-normal', '/health/diagnostics', [200], { headers });
    const spoof = await check('diagnostics-spoofed', '/health/diagnostics', [200], { headers: { ...headers, 'X-Forwarded-For': '198.51.100.66' } });
    if (normal.diagnostics && spoof.diagnostics) {
      spoof.ok = spoof.ok && normal.diagnostics.clientIp === spoof.diagnostics.clientIp && spoof.diagnostics.clientIp !== '198.51.100.66';
    }
  }
  const imageKey = process.env.VERIFY_IMAGE_KEY;
  if (imageKey) {
    const encoded = imageKey.split('/').map(encodeURIComponent).join('/');
    await check('existing-image', `/media/public/${encoded}`, process.env.VERIFY_IMAGE_REDIRECT === 'true' ? [307] : [200], { method: 'HEAD' });
    await check('image-origin', `/media/image-origin/${encoded}`, [200], { method: 'HEAD' });
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
