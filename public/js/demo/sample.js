// Build an in-browser sample clip from the synthetic renderer, so the whole
// flow can be tried (and tested) without a real video.

import { renderShot } from './synth.js';

const RPMS = [2600, 3200, 3800];
// Successive samples step through the RPM list, so a few clicks give a tunable session.
let counter = Math.floor(Math.random() * 1000) * 3;

export async function sampleClip({ seed = counter++, onProgress } = {}) {
  const rpm = RPMS[seed % RPMS.length];
  // Pretend launcher: exit speed rises with RPM, with a little shot-to-shot scatter.
  const jitter = (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.12;
  const v0 = 0.0018 * rpm + 1.6 + jitter;
  const angleDeg = 52 + jitter * 4;
  const shot = renderShot({
    width: 960, height: 540, fps: 240, duration: 0.75, pre: 0.06,
    v0, angleDeg, k: 0.045, ballDiameter: 0.072, color: 'yellow',
    pxPerM: 150, originPx: { x: 90, y: 470 }, noise: 3, seed,
  });
  const canvas = new OffscreenCanvas(960, 540);
  const ctx = canvas.getContext('2d');
  const frames = [];
  for (let i = 0; i < shot.frames.length; i++) {
    const f = shot.frames[i];
    ctx.putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
    frames.push({ t: i / shot.fps, blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) });
    if (i % 10 === 0) onProgress?.(i / shot.frames.length);
  }
  const stick = shot.cam.toPx(0.2, -0.05);
  const stickEnd = shot.cam.toPx(1.2, -0.05);
  return {
    clip: {
      method: 'sample',
      codec: 'synthetic',
      width: 960,
      height: 540,
      sourceWidth: 960,
      sourceHeight: 540,
      rotation: 0,
      frames,
      videoFps: shot.fps,
    },
    truth: { v0, angleDeg, k: 0.045, rpm, stickA: stick, stickB: stickEnd, launchFrame: Math.round(0.06 * shot.fps) },
  };
}
