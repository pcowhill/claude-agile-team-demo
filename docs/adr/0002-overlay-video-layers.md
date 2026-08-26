# 0002. Overlay video layers over a single base sequence

- Status: accepted
- Date: 2026-08-26
- Links: #133 (customer feedback), #145 (implementation issue), #146 (export
  compositing follow-up)

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
