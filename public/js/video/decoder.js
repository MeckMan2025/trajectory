// Turn a video file into an indexed list of frames with true timestamps.
// Main path: mp4box.js demux + WebCodecs VideoDecoder (exact per-frame timing).
// Fallback: an HTML <video> element stepped frame by frame at a known fps.
// Frames are kept as JPEG blobs so a few thousand of them fit in memory.

import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

export const MAX_FRAMES = 2400;
const JPEG_QUALITY = 0.92;

function cacheSize(w, h, maxWidth) {
  const s = Math.min(1, maxWidth / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function rotationFromMatrix(m) {
  if (!m || m.length < 5) return 0;
  const a = m[0] / 65536;
  const b = m[1] / 65536;
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function toBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
}

// Draw a source (VideoFrame or video element) into the cache canvas, applying rotation.
function drawRotated(ctx, src, sw, sh, rot, out) {
  ctx.save();
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  const swap = rot === 90 || rot === 270;
  const dw = swap ? out.height : out.width;
  const dh = swap ? out.width : out.height;
  ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function medianFps(times) {
  const d = [];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt > 0) d.push(dt);
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return 1 / d[d.length >> 1];
}

function codecDescription(file, trackId) {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return undefined;
}

async function demux(buffer) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    const samples = [];
    let info = null;
    let track = null;
    file.onError = (e) => reject(new Error(String(e)));
    file.onReady = (i) => {
      info = i;
      track = i.videoTracks[0];
      if (!track) {
        reject(new Error('No video track found in this file.'));
        return;
      }
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _user, s) => {
      for (const x of s) samples.push(x);
    };
    const buf = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    file.appendBuffer(buf);
    file.flush();
    // All samples are delivered synchronously once the whole file is appended.
    setTimeout(() => {
      if (!track) {
        reject(new Error('This file is not an MP4 or MOV the decoder can read.'));
        return;
      }
      resolve({ file, info, track, samples });
    }, 0);
  });
}

async function decodeWebCodecs(file, { maxWidth, onProgress, signal }) {
  if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs is not available in this browser.');
  const buffer = await file.arrayBuffer();
  const { file: mp4, track, samples } = await demux(buffer);
  if (!samples.length) throw new Error('No video frames found.');
  if (samples.length > MAX_FRAMES) {
    throw new Error(`This clip has ${samples.length} frames. Trim it to under ${MAX_FRAMES} frames (about ${Math.floor(MAX_FRAMES / 240)} s at 240 fps) and load it again.`);
  }
  const config = {
    codec: track.codec.startsWith('vp08') ? 'vp8' : track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description: codecDescription(mp4, track.id),
    hardwareAcceleration: 'no-preference',
  };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`This browser cannot decode ${track.codec}.`);

  const rot = rotationFromMatrix(track.matrix);
  const swap = rot === 90 || rot === 270;
  const srcW = swap ? track.video.height : track.video.width;
  const srcH = swap ? track.video.width : track.video.height;
  const size = cacheSize(srcW, srcH, maxWidth);
  const canvas = makeCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');

  const frames = [];
  const pending = [];
  let inflight = 0;
  let error = null;
  const decoder = new VideoDecoder({
    output: (vf) => {
      drawRotated(ctx, vf, vf.displayWidth, vf.displayHeight, rot, size);
      const t = vf.timestamp / 1e6;
      vf.close();
      inflight++;
      pending.push(toBlob(canvas).then((blob) => {
        frames.push({ t, blob });
        inflight--;
        onProgress?.(frames.length / samples.length);
      }));
    },
    error: (e) => {
      error = e;
    },
  });
  decoder.configure(config);

  for (const s of samples) {
    if (signal?.aborted) throw new Error('Cancelled.');
    if (error) throw error;
    decoder.decode(new EncodedVideoChunk({
      type: s.is_sync ? 'key' : 'delta',
      timestamp: (1e6 * s.cts) / s.timescale,
      duration: (1e6 * s.duration) / s.timescale,
      data: s.data,
    }));
    // Keep the queue short so memory stays bounded.
    while (decoder.decodeQueueSize > 8 || inflight > 12) {
      await new Promise((r) => setTimeout(r, 4));
    }
  }
  await decoder.flush();
  await Promise.all(pending);
  decoder.close();
  if (error) throw error;

  frames.sort((a, b) => a.t - b.t);
  const t0 = frames[0].t;
  for (const f of frames) f.t -= t0;
  return {
    method: 'webcodecs',
    codec: track.codec,
    width: size.width,
    height: size.height,
    sourceWidth: srcW,
    sourceHeight: srcH,
    rotation: rot,
    frames,
    videoFps: medianFps(frames.map((f) => f.t)),
  };
}

// Estimate a <video>'s frame rate by watching presented frames for a moment.
function estimateFps(video) {
  return new Promise((resolve) => {
    if (!video.requestVideoFrameCallback) {
      resolve(null);
      return;
    }
    const times = [];
    const tick = (_now, meta) => {
      times.push(meta.mediaTime);
      if (times.length < 20) video.requestVideoFrameCallback(tick);
      else {
        video.pause();
        resolve(medianFps(times));
      }
    };
    video.muted = true;
    video.requestVideoFrameCallback(tick);
    video.play().catch(() => resolve(null));
    setTimeout(() => {
      video.pause();
      resolve(times.length > 3 ? medianFps(times) : null);
    }, 3000);
  });
}

async function decodeElement(file, { maxWidth, onProgress, signal, fps }) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise((res, rej) => {
    video.onloadeddata = res;
    video.onerror = () => rej(new Error('This browser cannot play this video file.'));
  });
  const rate = fps || (await estimateFps(video)) || 30;
  video.pause();
  const count = Math.floor(video.duration * rate);
  if (count > MAX_FRAMES) throw new Error(`This clip has about ${count} frames. Trim it to under ${MAX_FRAMES} frames and load it again.`);
  const size = cacheSize(video.videoWidth, video.videoHeight, maxWidth);
  const canvas = makeCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new Error('Cancelled.');
    const t = (i + 0.5) / rate;
    await new Promise((res) => {
      video.onseeked = res;
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, size.width, size.height);
    frames.push({ t: i / rate, blob: await toBlob(canvas) });
    onProgress?.(frames.length / count);
  }
  URL.revokeObjectURL(url);
  return {
    method: 'element',
    codec: 'browser',
    width: size.width,
    height: size.height,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
    rotation: 0,
    frames,
    videoFps: rate,
  };
}

export async function decodeVideo(file, { maxWidth = 1280, onProgress, signal, onFallback } = {}) {
  try {
    return await decodeWebCodecs(file, { maxWidth, onProgress, signal });
  } catch (e) {
    if (/frames\. Trim|Cancelled/.test(e.message)) throw e;
    onFallback?.(e);
    return decodeElement(file, { maxWidth, onProgress, signal });
  }
}
