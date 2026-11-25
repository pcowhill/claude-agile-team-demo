# Sound library: sources and licence

Every file in this directory comes from one of two sources, both the
team's own work, and both arithmetic alone: oscillators, seeded noise and
filters. No recording, sample or third-party file goes into any of them.

- The sound effects (#861) are synthesised by `tools/sounds/recipes.ts`.
- The music beds (#869), the manifest's `Music` category, are composed and
  synthesised by `tools/sounds/music.ts`: chord progressions, synthesised
  instruments and a reverb, all in code.

**Licence: CC0 1.0 Universal (public domain dedication).**
To the extent possible under law, the authors have waived all copyright and
related or neighbouring rights to these sounds. They may be used, changed
and published, in videos or anywhere else, commercially or not, **without
attribution**. Full text: https://creativecommons.org/publicdomain/zero/1.0/

`manifest.json` records each file's licence (`CC0-1.0`) and its source,
which is the recipe or the track it was rendered from.

To regenerate the files and the manifest, which needs FFmpeg with libopus:

```sh
node tools/sounds/generateSounds.ts
```

The output repeats byte for byte, so a rerun that changes a file means a
recipe or a track changed.
