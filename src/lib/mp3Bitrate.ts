/**
 * The MP3 export's encoding bitrate (#269), kept out of `exportMp3.ts` so
 * the entry bundle can read it without pulling that module in (#503) —
 * the `src/plugins/gifLimits.ts` pattern for the same shape: `exportMp3.ts`
 * is reached by `exportFormats.ts` through a dynamic `import()` so the
 * MP3 glue and the encoder load only when an MP3 export runs, and a static
 * import of the same module from the user guide's constants (#482) defeated
 * that split for the glue (`INEFFECTIVE_DYNAMIC_IMPORT`). The encoder reads
 * the number here to encode; the guide reads it to state it, so the guide
 * cannot say "192 kbps" after the encoder says otherwise.
 *
 * 192 kbps CBR: comfortably transparent for mixed speech/music at MP3's
 * efficiency, and still ~24 KB per second of audio. (The WebM path records
 * Opus at the browser's default, typically 128 kbps — a more efficient
 * codec, so the MP3 needs the higher number to keep up.)
 */
export const MP3_KBPS = 192
