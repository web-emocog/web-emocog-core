import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATASET, privateFile, fingerprint, parsePpg, assessAlignment } from './reference.mjs';

const root = process.env.WECOG_REFERENCE_ROOT;
const image = process.env.WECOG_REFERENCE_DECODER_IMAGE;
if (!root || !/^sha256:[a-f0-9]{64}$/.test(image || '')) throw new Error('Set private WECOG_REFERENCE_ROOT and an immutable local Docker image ID with ffmpeg/ffprobe');
const base = await fs.realpath(root);
const derived = path.join(base, 'derived');
await fs.mkdir(derived, { recursive: true, mode: 0o700 });
if (await fs.realpath(derived) !== derived) throw new Error('linked_output_directory');
const manifest = { dataset: DATASET, files: [], assessment: {}, replay: {} };
function decode(binary, args, writable = false) {
  const common = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '1g', '--cpus', '2', '--tmpfs', '/tmp:rw,nosuid,size=128m',
    '--user', `${process.getuid()}:${process.getgid()}`, '--entrypoint', binary,
    '--mount', `type=bind,source=${base},target=/reference,readonly`];
  if (writable) common.push('--mount', `type=bind,source=${derived},target=/output`);
  const result = spawnSync('docker', [...common, image, ...args], { encoding: 'utf8', timeout: 240000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('reference_decoder_failed');
  return result;
}
for (const id of ['1020_FullHDwebcam_before', '1020_FullHDwebcam_after', '1024_FullHDwebcam_before']) {
  const video = `video/${id}.avi`, ppg = `ppg_sync/${id}.txt`, meta = `meta/${id}.txt`;
  const signal = parsePpg(await fs.readFile(await privateFile(base, ppg), 'utf8'));
  const timestamps = (await fs.readFile(await privateFile(base, meta), 'utf8')).trim().split(/\r?\n/);
  const probe = decode('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,avg_frame_rate,nb_read_frames', '-of', 'json', `/reference/${video}`]);
  const stream = JSON.parse(probe.stdout).streams[0];
  manifest.assessment[id] = { ...assessAlignment({ decodedFrames: Number(stream.nb_read_frames), referenceSamples: signal.length,
    captureTimestamps: timestamps.length, decoderErrors: probe.stderr.trim().length > 0 }),
    decodedFrames: Number(stream.nb_read_frames), referenceSamples: signal.length, captureTimestamps: timestamps.length,
    width: stream.width, height: stream.height, containerRate: stream.avg_frame_rate };
  for (const relative of [video, ppg, meta]) {
    const file = await privateFile(base, relative), actual = await fingerprint(file);
    const metadata = (await fs.readFile(path.join(base, '.cache/huggingface/download', relative + '.metadata'), 'utf8')).trim().split('\n');
    if (metadata[0] !== DATASET.revision || (/^[a-f0-9]{64}$/.test(metadata[1]) && metadata[1] !== actual.sha256)) throw new Error('download_revision_or_hash_mismatch');
    manifest.files.push({ path: relative, ...actual });
  }
}
// The original files are retained. Only a strict-decode prefix is used as a
// functional face test; it is not promoted to a synchronized accuracy benchmark.
decode('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', '/reference/video/1020_FullHDwebcam_before.avi',
  '-t', '60', '-map', '0:v:0', '-an', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuv420p', '-threads', '2', '-y', '/output/1020_before_first60.webm'], true);
const replay = 'derived/1020_before_first60.webm';
manifest.files.push({ path: replay, ...await fingerprint(await privateFile(base, replay)) });
manifest.replay = { path: replay, source: 'video/1020_FullHDwebcam_before.avi', durationSeconds: 60,
  decoderImage: image, strictDecodePassed: true, transformation: 'VP9 lossless in decoded YUV420; no audio, scaling or rate override' };
await fs.writeFile(path.join(base, 'local-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ dataset: DATASET.id, assessments: manifest.assessment, files: manifest.files.length, accuracyValidated: false }, null, 2));
