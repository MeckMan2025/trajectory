// Encode synthetic shots into real video files with ffmpeg, so the decoder path
// (mp4box + WebCodecs) is tested with the same kind of file a phone produces.
// Usage: node tools/make-fixtures.mjs   (needs ffmpeg on PATH)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderShot } from '../public/js/demo/synth.js';

const dir = 'test/fixtures';
mkdirSync(dir, { recursive: true });

export const FIXTURE = {
  width: 960, height: 540, fps: 240, duration: 0.75, pre: 0.06,
  v0: 7.4, angleDeg: 50, k: 0.045, ballDiameter: 0.072, color: 'yellow',
  pxPerM: 150, originPx: { x: 90, y: 470 }, noise: 3, seed: 21,
};

function encode(frames, file, args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${FIXTURE.width}x${FIXTURE.height}`, ...args.input, '-i', '-', ...args.output, file]);
    ff.on('error', reject);
    ff.on('close', (code) => (code ? reject(new Error(`ffmpeg exit ${code} for ${file}`)) : resolve()));
    for (const f of frames) ff.stdin.write(Buffer.from(f.data.buffer));
    ff.stdin.end();
  });
}

const shot = renderShot(FIXTURE);
const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-qp', '14', '-movflags', '+faststart'];
// A true 240 fps file, as AirDrop of the original slow-motion clip gives you.
await encode(shot.frames, `${dir}/shot-240.mp4`, { input: ['-r', '240'], output: [...h264, '-r', '240'] });
// The same frames played at 30 fps: what a re-timed slow-motion export looks like.
await encode(shot.frames, `${dir}/shot-retimed-30.mp4`, { input: ['-r', '30'], output: [...h264, '-r', '30'] });
// HEVC in a QuickTime container, like an iPhone .MOV.
await encode(shot.frames, `${dir}/shot-240-hevc.mov`, { input: ['-r', '240'], output: ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-x265-params', 'qp=16:log-level=error', '-tag:v', 'hvc1', '-r', '240'] });

const stickA = { x: FIXTURE.originPx.x + 0.2 * FIXTURE.pxPerM, y: FIXTURE.originPx.y + 0.05 * FIXTURE.pxPerM };
const stickB = { x: stickA.x + FIXTURE.pxPerM, y: stickA.y };
writeFileSync(`${dir}/truth.json`, JSON.stringify({ ...FIXTURE, stickA, stickB, launchFrame: Math.round(FIXTURE.pre * FIXTURE.fps) }, null, 2) + '\n');
console.log('fixtures written to', dir);
