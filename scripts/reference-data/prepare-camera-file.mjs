// Local reference media only. The output is never served by the web application.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateFile, verifyManifest, fingerprint } from './reference.mjs';

export function validateCameraFileMetadata(metadata, source, output) {
    if (metadata?.schemaVersion !== 'fake-camera-file.v1' || metadata.sourceSha256 !== source.sha256
        || metadata.outputSha256 !== output.sha256 || metadata.outputBytes !== output.bytes
        || !/^sha256:[a-f0-9]{64}$/.test(metadata.decoderImage || '')
        || metadata.transformation !== 'VP9-to-YUV420-Y4M-no-scaling-no-rate-override-no-audio') {
        throw new Error('invalid_benchmark_fake_video_provenance');
    }
    return metadata;
}

async function main() {
    const image = process.env.WECOG_REFERENCE_DECODER_IMAGE;
    if (!/^sha256:[a-f0-9]{64}$/.test(image || '') || !process.env.WECOG_REFERENCE_ROOT) throw new Error('invalid_camera_prepare_options');
    const root = await fs.realpath(process.env.WECOG_REFERENCE_ROOT);
    const manifest = JSON.parse(await fs.readFile(await privateFile(root, 'local-manifest.json', 100000), 'utf8'));
    await verifyManifest(root, manifest);
    const source = await privateFile(root, manifest.replay.path);
    const locked = manifest.files.find(row => row.path === manifest.replay.path);
    if (!locked) throw new Error('unlocked_camera_source');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-fake-camera-'));
    await fs.chmod(directory, 0o700);
    const output = path.join(directory, 'reference.y4m');
    const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '1g', '--cpus', '2',
        '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,nosuid,size=64m',
        '--mount', `type=bind,source=${path.dirname(source)},target=/input,readonly`,
        '--mount', `type=bind,source=${directory},target=/output`, '--entrypoint', 'ffmpeg', image,
        '-hide_banner', '-v', 'error', '-xerror', '-i', '/input/' + path.basename(source), '-map', '0:v:0',
        '-an', '-pix_fmt', 'yuv420p', '-vsync', '0', '-f', 'yuv4mpegpipe', '/output/reference.y4m'],
        { encoding: 'utf8', timeout: 240000, maxBuffer: 100000 });
    if (result.error || result.status !== 0) throw new Error('camera_reference_decoder_failed');
    await fs.chmod(output, 0o600);
    const actual = await fingerprint(output);
    const metadata = { schemaVersion: 'fake-camera-file.v1', sourceSha256: locked.sha256,
        outputSha256: actual.sha256, outputBytes: actual.bytes, decoderImage: image,
        transformation: 'VP9-to-YUV420-Y4M-no-scaling-no-rate-override-no-audio' };
    await fs.writeFile(output + '.json', JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({ path: output, ...metadata }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch(error => {
        process.stderr.write(/^[a-z_]+$/.test(error.message) ? error.message + '\n' : 'camera_reference_prepare_failed\n');
        process.exitCode = 1;
    });
}
