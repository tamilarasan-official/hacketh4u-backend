// Local preparation only. Never writes Dokploy or prints secret values.
const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const output = resolve(process.argv[2] || '.env.rollout.local');
const cachePassword = randomBytes(32).toString('hex');
const text = [
  '# Private: copy values into Dokploy Environment, never commit this file.',
  `METRICS_TOKEN=${randomBytes(32).toString('hex')}`,
  `PLAYBACK_SECRET=${randomBytes(32).toString('hex')}`,
  `CACHE_REDIS_PASSWORD=${cachePassword}`,
  `CACHE_REDIS_URL=redis://:${cachePassword}@profile-cache:6379`,
  '',
].join('\n');
writeFileSync(output, text, { flag: 'wx', mode: 0o600 });
console.log(`Secrets written to ${output}. Existing files are never overwritten.`);
