# Procedural media fixtures

`passive-video.webm` is a generated solid-red 64 x 64 VP8 video: 10 frames at
10 FPS, 1 second, no audio. It contains no participant or third-party imagery.
It replaces timing-dependent canvas/MediaRecorder generation in the passive
video preload test. Consumers need no encoder installed.

The fixture was encoded with Playwright's bundled FFmpeg/libvpx from ten copies
of a generated red JPEG via `image2pipe` and `-frames:v 10 -c:v libvpx -b:v 20000`.
The encoder is not redistributed here. FFmpeg/libvpx notices remain with the
existing Playwright installation; this change adds no runtime codec dependency.
