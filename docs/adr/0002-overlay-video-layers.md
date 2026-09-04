# 0002. Overlay video layers over a single base sequence

- Status: accepted
- Date: 2026-08-26
- Links: #133 (customer feedback), #145 (implementation issue), #146 (export
  compositing follow-up), #277/#294 (still overlays — see the addendum),
  #295 (still overlays in the export)

## Context

The customer wants several clips visible at once (#133): face-cam-in-corner
picture-in-picture and side-by-side multi-angle layouts. The product had
exactly one video sequence; only transitions ever showed two clips
simultaneously. Two architectures could serve this:

1. **General multi-track editing** — several parallel video sequences, each
   with the full entry feature set (trims, transitions, zooms, remaps),
   composited by track order.
2. **A single base sequence plus overlay layers** — video clips placed above
   the sequence, each with a sequence-time window, its own trim, a placement
   rectangle, and volume/mute, but none of the entry-level effects.

## Decision

Option 2: keep the one base sequence and add **overlay layers**
(`VideoOverlay` in `src/lib/videoOverlay.ts`, owned by `TimelineState` like
every other effect).

- **Anchoring**: an overlay's `offset` is absolute sequence seconds, exactly
  the audio-track model (#102), including the allowed-tail semantics — video
  edits never re-anchor or drop an overlay; a window past the sequence's end
  simply never shows. One anchoring rule now covers audio tracks, text
  overlays (#139), and video overlays.
- **Placement**: a rectangle in fractional frame coordinates (`x`/`y`
  top-left, `width`/`height`), clamped fully onto the frame. The clip
  letterboxes *within* the rectangle (aspect preserved, transparent gutters
  showing the base video) — the same aspect-fit rule the stage applies to
  base clips, so no aspect ratio ever distorts.
- **Stacking**: add order, later on top; text overlays always render above
  video overlays (a title annotates the whole output frame).
- **Scope**: no transitions, zooms, or time remapping on overlays. Overlays
  carry video clips only.
- **Side-by-side falls out of composition** rather than a dedicated layout
  feature: a color slate (#143) as the base entry with two or more overlays
  placed in halves or quadrants.

## Consequences

Easier: the entire existing playback/export machinery (entry handover,
transition overlap, remap replay) stays untouched — overlays follow the far
simpler audio-track sync pattern (one media element per layer, window +
drift correction, #103), and export compositing (#146) is a per-frame
`drawImage` into the rectangle above the existing composition. `.bvep`
stays additive within the schema version.

Harder / constrained: overlays cannot themselves crossfade, zoom, or remap;
a multi-angle edit that needs per-layer effects would need those features
added to overlays deliberately (or the general multi-track model revisited,
superseding this ADR). Overlap of the base entry's audio and overlay audio
is governed only by per-layer volume/mute — there is no automatic ducking.

General multi-track was rejected because every entry feature (transitions,
zooms, remaps, and their normalization) would have to become track-aware at
once — a rewrite of the timeline model to serve two concrete layouts the
simpler model already covers, and reversible later only at even greater
cost. The overlay model is additive and leaves that door open.

## Addendum (2026-09-04): still overlays, #294

The customer approved logos, watermarks and stickers as overlay layers
(#277 → #294). The choice was whether a still overlay is a **second kind
inside this lane** or a **collection of its own**.

It is a second kind inside this lane: `VideoOverlay` gains an optional
`kind: 'image'` — absent meaning video, the `TimelineEntry.kind` rule
(#140) — and every rule above is unchanged for it. Anchoring, placement,
clamping, stacking, the clip-removal rule, duplication (#314) and the
whole treatment set (colour #192, orientation #232, crop #255, shape mask
#266) are shared code, not parallel code.

Two things differ, and only two:

- **No audio.** A still is soundless (#220), so an image overlay carries no
  `volume`, `muted`, `fadeIn` or `fadeOut`. This is enforced three times
  over, deliberately: the reducer's validator refuses an action carrying
  one, the project-file parser refuses such a file *by field name*, and
  `clampVideoOverlay` drops any that reach the model anyway. The row shows
  no audio controls at all rather than disabled ones.
- **The window is `offset` + `duration`,** not a trim of a source — a still
  has no source duration to trim. It is still *stored* as
  `inPoint`/`outPoint` pinned to `[0, duration]`, exactly as a still
  sequence entry's window is, so every shared window helper
  (`audioTrackPlaybackAt`, `effectiveDuration`) keeps working unchanged.

A separate collection was rejected: it would have duplicated the lane's
rules (stacking, anchoring, clip removal, history) and forced an eighth
positional argument through `withEffects`'s fifty call sites — churn that
buys nothing, since the two kinds share almost everything. The cost of the
choice taken is that the state and file key stays `videoOverlays` while
holding both kinds; renaming it would be a schema break with no benefit to
the customer, so it stays, and the type's own name (`VideoOverlay`) is the
lane's name rather than a claim about every member.

**The export renders still overlays as of #295.** When this addendum was
first written it did not: `activeVideoOverlays` skipped them, pinned by
test, because feeding an image URL to the overlay video-replay path would
have stalled the export on a `<video>` that can never load.

#295 resolved that by separating the two things the old code had
conflated — *which layers are visible* and *where a layer's picture comes
from*. The window test is now kind-blind, since the model pins a still's
window to `[0, duration]` and the shared rule reads it directly; the
composer picks the source per kind, a replay element for a video layer and
the decoded `<img>` from the shared `stillSources` map for a still. Two
consequences worth recording, because both are load-bearing:

- **Stills stay out of `overlayReplays`.** That list exists to be seeked,
  played and mixed, none of which an `<img>` can do — and because every
  audio path (the Web Audio graph and the per-frame gain sync) is fed from
  it, "a still contributes no audio source" is true by construction rather
  than by a check someone must remember. The frame snapshot branches on the
  kind for the same reason.
- **Stills contribute nothing to the output frame size.** Their URLs join
  `stillSources` but never `urlDims`: the frame is decided by the
  sequence's own sources (#176), so a watermark cannot reshape the video
  under it.
