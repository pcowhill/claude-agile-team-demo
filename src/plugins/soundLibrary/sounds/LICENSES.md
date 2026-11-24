# Sound library: sources and licence

Every file in this directory comes from one source. It is synthesised by
`tools/sounds/recipes.ts`, from arithmetic alone: oscillators, seeded
noise and filters. No recording, sample or third-party file goes into any
of them. They are the team's own work (#861).

**Licence: CC0 1.0 Universal (public domain dedication).**
To the extent possible under law, the authors have waived all copyright and
related or neighbouring rights to these sounds. They may be used, changed
and published, in videos or anywhere else, commercially or not, **without
attribution**. Full text: https://creativecommons.org/publicdomain/zero/1.0/

`manifest.json` records each file's licence (`CC0-1.0`) and its source,
which is the recipe it was rendered from.

To regenerate the files and the manifest, which needs FFmpeg with libopus:

```sh
node tools/sounds/generateSounds.ts
```

The output repeats byte for byte, so a rerun that changes a file means a
recipe changed.
