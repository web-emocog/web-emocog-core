const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const { resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');
const { HttpError } = require('../security/http-error');

let active = 0;
const pending = new Map();

function runMediaTool(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    let failure = null;
    const timer = setTimeout(() => {
      failure = new HttpError(504, 'Media inspection timed out', 'media_preview_timeout');
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 64 * 1024) {
        failure = new HttpError(422, 'Media metadata exceeds limits', 'media_metadata_oversized');
        child.kill('SIGKILL');
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new HttpError(503, 'Media preview tool is unavailable', 'media_preview_unavailable'));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new HttpError(422, 'Media cannot be decoded', 'media_decode_failed'));
      else resolve(output);
    });
  });
}

async function createPreview(version, uploadsRoot, options = config.storage.preview) {
  if (!/^(image|video|audio)\//.test(version.mime_type)) return { status: 'unsupported', info: {} };
  if (active >= options.maxConcurrent) throw new HttpError(503, 'Media preview is busy; retry', 'media_preview_busy');
  active += 1;
  let temporary;
  try {
    const input = await resolveReadableServerOwnedUploadPath(uploadsRoot, version.content_path);
    if (!input.ok) throw new HttpError(422, 'Media is unavailable', input.code);
    const raw = await runMediaTool(options.ffprobeBin, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', input.absolutePath], options.timeoutMs);
    let metadata;
    try { metadata = JSON.parse(raw); } catch (_) { throw new HttpError(422, 'Invalid media metadata', 'media_decode_failed'); }
    if (version.mime_type.startsWith('audio/')) {
      const audio = (metadata.streams || []).find(item => item.codec_type === 'audio');
      const duration = Number(metadata.format?.duration);
      if (!audio || !(duration > 0)) throw new HttpError(422, 'Audio cannot be decoded', 'media_decode_failed');
      await runMediaTool(options.ffmpegBin, ['-nostdin', '-v', 'error', '-xerror', '-max_alloc', '67108864',
        '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', input.absolutePath,
        '-map', '0:a:0', '-t', '1', '-f', 'null', '-'], options.timeoutMs);
      return { status: 'unsupported', info: { validated_sha256: version.sha256,
        codec: audio.codec_name, duration_ms: Math.round(duration * 1000) } };
    }
    const stream = (metadata.streams || []).find(item => item.codec_type === 'video');
    if (version.mime_type.startsWith('video/')) {
      const codecs = version.mime_type === 'video/mp4' ? ['h264', 'av1', 'vp9'] : ['vp8', 'vp9', 'av1'];
      if (!codecs.includes(stream?.codec_name)) throw new HttpError(422, 'Use H.264 MP4 or VP8/VP9 WebM', 'media_codec_unsupported');
    }
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (!(width > 0 && height > 0 && width * height <= 32_000_000)) {
      throw new HttpError(422, 'Media dimensions exceed limits', 'media_dimensions_invalid');
    }
    const directory = path.join(uploadsRoot, 'previews');
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    temporary = path.join(directory, `${crypto.randomUUID()}.jpg`);
    await runMediaTool(options.ffmpegBin, ['-nostdin', '-v', 'error', '-xerror', '-max_alloc', '67108864',
      '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', input.absolutePath,
      '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-threads', '1',
      '-vf', `scale=w='min(${options.maxDimension},iw)':h='min(${options.maxDimension},ih)':force_original_aspect_ratio=decrease`,
      '-q:v', '4', '-f', 'image2', temporary], options.timeoutMs);
    const stat = await fs.promises.stat(temporary);
    if (!stat.size || stat.size > 2 * 1024 * 1024) throw new HttpError(422, 'Preview exceeds limits', 'media_preview_oversized');
    const duration = Number(metadata.format?.duration);
    const result = { status: 'ready', path: path.relative(uploadsRoot, temporary),
      info: { intrinsic_width: width, intrinsic_height: height, codec: String(stream.codec_name || '').slice(0, 64),
        ...(Number.isFinite(duration) && duration >= 0 ? { duration_ms: Math.round(duration * 1000) } : {}) } };
    temporary = null;
    return result;
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => {});
    active -= 1;
  }
}

async function ensurePreview(queryable, version, uploadsRoot) {
  if (version.preview_status === 'ready' && version.media_info?.validated_sha256 === version.sha256) return version;
  if (version.preview_status === 'unsupported' && version.media_info?.validated_sha256 === version.sha256) return version;
  if (pending.has(version.id)) return pending.get(version.id);
  const task = (async () => {
    let preview;
    try { preview = await createPreview(version, uploadsRoot); }
    catch (error) {
      if (error.code === 'media_preview_busy') throw error;
      preview = { status: 'failed', info: { preview_error: error.code || 'media_preview_failed' } };
    }
    if (preview.status === 'ready') preview.info.validated_sha256 = version.sha256;
    const result = await queryable.query(`UPDATE stimulus_versions
      SET preview_path = $1, preview_status = $2, media_info = $3::jsonb WHERE id = $4 RETURNING *`,
    [preview.path || null, preview.status, JSON.stringify(preview.info), version.id]);
    return result.rows[0];
  })();
  pending.set(version.id, task);
  try { return await task; } finally { pending.delete(version.id); }
}

async function ensurePlayableVersion(queryable, version, uploadsRoot) {
  // Documents must become image slides before they can enter a participant protocol.
  if (!/^(image|video|audio)\//.test(version.mime_type)) {
    throw new HttpError(422, 'Convert documents to slides before publication', 'media_presentation_unsupported');
  }
  const inspected = await ensurePreview(queryable, version, uploadsRoot);
  if (inspected.preview_status !== 'ready' && !(version.mime_type.startsWith('audio/')
      && inspected.preview_status === 'unsupported' && inspected.media_info?.validated_sha256 === version.sha256)) {
    const code = inspected.media_info?.preview_error || 'media_decode_failed';
    const status = code === 'media_preview_unavailable' ? 503 : code === 'media_preview_timeout' ? 504 : 422;
    throw new HttpError(status,
      'Media cannot be decoded; upload a playable image, MP4 or WebM file', code);
  }
  return inspected;
}

module.exports = { runMediaTool, createPreview, ensurePreview, ensurePlayableVersion };
