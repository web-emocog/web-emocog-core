# Synthetic Image Fixtures

`synthetic-color.jpg`, `.gif` and `.webp` are a solid green 64 x 48 image,
generated for native upload/preview and browser decoding tests. They contain
no personal data and no external artwork.

```sh
for ext in jpg gif webp; do
  ffmpeg -nostdin -v error -f lavfi -i color=c=0x36a269:s=64x48 \
    -frames:v 1 -y "synthetic-color.$ext"
done
```

They are codec fixtures, not physiological reference data. The GIF has one frame;
this test does not validate gaze synchronization against a changing animation.
