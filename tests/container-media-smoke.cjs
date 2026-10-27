// Run inside the built runtime image. No cloud credentials or network required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
Object.assign(process.env, {
  NODE_ENV: 'test', PORT: '3000', APP_BASE_URL: 'https://api.test',
  FIREBASE_PROJECT_ID: 'demo-hacketh4u-local', FIREBASE_CLIENT_EMAIL: 'test@test.invalid',
  FIREBASE_PRIVATE_KEY: 'test-only', RAZORPAY_KEY_ID: 'test', RAZORPAY_KEY_SECRET: 'test',
  GARAGE_S3_ENDPOINT: 'http://127.0.0.1:9', GARAGE_S3_REGION: 'us-east-1',
  GARAGE_S3_BUCKET: 'test', GARAGE_S3_ACCESS_KEY_ID: 'test', GARAGE_S3_SECRET_ACCESS_KEY: 'test',
  GARAGE_S3_PUBLIC_BASE_URL: 'https://bucket.test', FFMPEG_THREADS: '1'
});
const { garageS3 } = appRequire('/app/dist/config/garage.js');
const { processGarageVideoToHls } = appRequire('/app/dist/services/video-processing.service.js');
const uploads = new Map();
garageS3.send = async command => {
  if (command.constructor.name === 'GetObjectCommand') return { Body: fs.createReadStream('/tmp/fixture.mp4') };
  assert.equal(command.constructor.name, 'PutObjectCommand');
  const chunks = [];
  for await (const chunk of command.input.Body) chunks.push(chunk);
  uploads.set(command.input.Key, Buffer.concat(chunks));
  return {};
};
(async () => {
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '8', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '/tmp/fixture.mp4'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(generated.status, 0, generated.stderr);
  const result = await processGarageVideoToHls({ objectKey: 'videos/raw/test-user/fixture.mp4', publicUrl: 'https://api.test/media/public/videos/raw/test-user/fixture.mp4', contentType: 'video/mp4' });
  const keys = [...uploads.keys()];
  const masterKey = `${result.hlsObjectPrefix}/master.m3u8`;
  assert.equal(keys.at(-1), masterKey, 'Master must publish last');
  const master = uploads.get(masterKey).toString();
  assert.equal((master.match(/RESOLUTION=320x180/g) || []).length, 2, 'Do not upscale small sources or advertise false dimensions');
  for (const label of ['480p', '720p']) {
    const playlistKey = `${result.hlsObjectPrefix}/${label}/index.m3u8`;
    const playlist = uploads.get(playlistKey).toString();
    assert.match(playlist, /#EXT-X-ENDLIST/);
    assert.match(playlist, /#EXT-X-INDEPENDENT-SEGMENTS/);
    const durations = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map(x => Number(x[1]));
    assert.equal(durations.length, 2);
    assert.ok(durations.every(n => n > 0 && n <= 6.1));
    for (const segment of playlist.split('\n').filter(x => x.endsWith('.ts'))) {
      const segmentKey = `${result.hlsObjectPrefix}/${label}/${segment}`;
      assert.ok(uploads.get(segmentKey).length > 188);
      assert.ok(keys.indexOf(segmentKey) < keys.indexOf(playlistKey), 'Segments must precede rendition manifest');
    }
  }
  console.log(JSON.stringify({ result: 'PASS', fixtureSeconds: 8, source: '320x180', renditions: 2, segments: 4, uploadedObjects: uploads.size, masterPublishedLast: true, usesRealFFmpeg: true, externalStorageCalls: 0 }));
  garageS3.destroy();
})().catch(error => { console.error(error); garageS3.destroy(); process.exitCode = 1; });
