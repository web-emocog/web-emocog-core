# Synthetic Media Fixture

`stimulus-video.mp4` is an original, generated solid-red video with no people,
third-party imagery, audio or participant data. It is covered by the repository
license. Geometry: 640x360; duration: 0.3 seconds; codec: H.264; yuv420p.

Generated with FFmpeg 8.0.1 and its libx264 encoder:

```bash
ffmpeg -f lavfi -i color=c=red:s=640x360:r=10 -t 0.3 \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart stimulus-video.mp4
```

Different encoder builds can produce different binary hashes. The checked-in
fixture SHA-256 is:

```text
dc03bc0e304119bae402cd62159391de897840e31f28c37527de294ed4aa0d39
```

Tests exercise real upload, video decoding, posters and byte-range delivery;
FFmpeg itself is a separate system tool, not embedded in this fixture.
