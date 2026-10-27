// Read-only, bounded comparison: 12 signed HEAD requests; no object bodies or writes.
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('node:https');
const { performance } = require('node:perf_hooks');
async function main() {
  const key = process.env.STORAGE_PROBE_KEY;
  if (!key) throw Error('Set STORAGE_PROBE_KEY to one existing object key.');
  for (const name of ['GARAGE_S3_ENDPOINT', 'GARAGE_S3_REGION', 'GARAGE_S3_BUCKET', 'GARAGE_S3_ACCESS_KEY_ID', 'GARAGE_S3_SECRET_ACCESS_KEY'])
    if (!process.env[name]) throw Error(`Missing ${name}`);
  const results = [];
  for (const keepAlive of [false, true]) {
    const agent = new https.Agent({ keepAlive, maxSockets: 1, maxFreeSockets: 1, timeout: 20000 });
    let connections = 0;
    const original = agent.createConnection.bind(agent);
    agent.createConnection = (...args) => { connections++; return original(...args); };
    const client = new S3Client({
      endpoint: process.env.GARAGE_S3_ENDPOINT, region: process.env.GARAGE_S3_REGION,
      forcePathStyle: process.env.GARAGE_S3_FORCE_PATH_STYLE === 'true', maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: process.env.GARAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.GARAGE_S3_SECRET_ACCESS_KEY },
      requestHandler: new NodeHttpHandler({ httpsAgent: agent, connectionTimeout: 10000, requestTimeout: 25000, socketTimeout: 25000 }),
    });
    try {
      for (let n = 0; n < 6; n++) {
        if (n === 3) await new Promise(r => setTimeout(r, 30000));
        const start = performance.now();
        try {
          const response = await client.send(new HeadObjectCommand({ Bucket: process.env.GARAGE_S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(15000) });
          results.push({ keepAlive, request: n + 1, afterIdle: n === 3, status: response.$metadata.httpStatusCode, ms: Math.round(performance.now() - start), connections });
        } catch (e) { results.push({ keepAlive, request: n + 1, afterIdle: n === 3, error: e.name, code: e.code, status: e.$metadata?.httpStatusCode, ms: Math.round(performance.now() - start), connections }); }
      }
    } finally { client.destroy(); agent.destroy(); }
  }
  console.log(JSON.stringify({ readOnly: true, requestCount: 12, results }, null, 2));
  if (results.some(r => r.error || r.status !== 200)) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
