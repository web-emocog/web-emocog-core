# Synthetic MP3 fixture

`synthetic-tone.mp3` is a generated 0.5-second, 440 Hz sine, not a human
recording or physiological reference. Generated with the test API image:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=16000' \
  -t 0.5 -c:a libmp3lame -b:a 32k synthetic-tone.mp3
```

Used only to test actual browser decoding and playback of MP3 stimuli.

`synthetic-tone.ogg` contains the same synthetic tone encoded as Ogg/Opus:

```sh
ffmpeg -nostdin -v error -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 0.5 -c:a libopus -b:a 24k synthetic-tone.ogg
```

This checks this codec/container combination, not every possible Ogg codec.
