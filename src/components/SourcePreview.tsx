import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { targetEditsText } from '../lib/history'
import type { LibraryClip } from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import {
  modalDialogOpen,
  stepTarget,
  targetClaimsKeys,
  transportActionForKey,
} from '../lib/transport'
import { AudioWaveform } from './AudioWaveform'
import './SourcePreview.css'

/** Badge text per kind — the library's wording (#101, #120, #137). */
const KIND_LABELS: Record<LibraryClip['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
}

/** Same tolerance as the sequence transport's play-from-the-end rule. */
const END_EPSILON = 0.02

interface SourcePreviewProps {
  /** The library clip being auditioned. */
  clip: LibraryClip
  /**
   * The output frame's aspect ratio (#176) — the same shape the sequence's
   * frame has, so the panel keeps its shape when switching between the two
   * modes; the source letterboxes inside it exactly as a placed clip would.
   */
  aspect: number
  /** Whether the preview panel spans the full content width (#128). */
  expanded?: boolean
  /** Back to the sequence — the header button, and Escape. */
  onBack: () => void
  /** The library row's Add / Overlay actions, offered here for convenience. */
  onAddToTimeline?: (clip: LibraryClip) => void
  onAddOverlay?: (clip: LibraryClip) => void
  /** The arrow steps, as the sequence transport has them (#286). */
  stepSeconds?: number
  largeStepSeconds?: number
}

/**
 * Source preview (#403, from feedback #397): one library clip alone in the
 * preview panel, without adding it to the timeline — to tell two similarly
 * named songs apart, or to scrub an imported video to recall its contents.
 * Rendered by `PreviewPlayer` in place of its sequence stage and transport,
 * which stay mounted (only hidden) so the sequence comes back exactly as it
 * was: playhead, marks, and the idle-cued frame untouched.
 *
 * A video or audio clip has its own play/pause, seek slider and time
 * readout; an image simply shows. The media element here is this
 * component's own, cued declaratively from the clip's URL — nothing it does
 * reaches the sequence's stacked elements, project state, autosave or the
 * export.
 */
export function SourcePreview({
  clip,
  aspect,
  expanded = false,
  onBack,
  onAddToTimeline,
  onAddOverlay,
  stepSeconds,
  largeStepSeconds,
}: SourcePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const media = () => videoRef.current ?? audioRef.current
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const frameRef = useRef<number | null>(null)
  // An image has no clock: no transport, and the transport keys are inert.
  const hasClock = clip.kind !== 'image'
  const duration = hasClock ? clip.duration : 0

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  // Publishes the element's clock while it plays — the slider follows the
  // source, and the loop stops itself when the source ends or is paused by
  // anything other than this component (a browser media-key, say).
  const tick = useCallback(() => {
    const element = media()
    if (element === null) return
    setTime(element.currentTime)
    if (element.paused || element.ended) {
      frameRef.current = null
      setPlaying(false)
      return
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  const play = useCallback(() => {
    const element = media()
    if (element === null) return
    // Play from the end restarts the source, like the sequence transport.
    if (duration > 0 && element.currentTime >= duration - END_EPSILON) {
      element.currentTime = 0
      setTime(0)
    }
    void element.play().catch(() => setPlaying(false))
    setPlaying(true)
    stopLoop()
    frameRef.current = requestAnimationFrame(tick)
  }, [duration, stopLoop, tick])

  const pause = useCallback(() => {
    stopLoop()
    media()?.pause()
    setPlaying(false)
  }, [stopLoop])

  const seek = useCallback(
    (to: number) => {
      const target = Math.min(Math.max(to, 0), duration)
      const element = media()
      if (element !== null) element.currentTime = target
      setTime(target)
    },
    [duration],
  )

  // A different clip previewed while this mode is up: its element is cued
  // afresh from the new URL, and the readout starts over with it.
  useEffect(() => {
    stopLoop()
    setPlaying(false)
    setTime(0)
  }, [clip.id, stopLoop])

  useEffect(() => stopLoop, [stopLoop])

  // The transport keys drive the source while it is up (#403): the same
  // mapping and the same guards as the sequence transport (#203) — inert
  // over a control with its own keyboard behavior and under any modal. The
  // sequence player's own handler stands down for these keys while a source
  // is previewed, so each keydown is claimed exactly once. ↑ / ↓ are
  // sequence-only (edit points, #391) and `?` stays the sequence player's:
  // both are left alone here. Escape leaves the mode, from anywhere but a
  // text field or a dialog (which claims Escape for itself).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (modalDialogOpen(document) || targetEditsText(event.target)) return
        event.preventDefault()
        onBack()
        return
      }
      const action = transportActionForKey(event, {
        step: stepSeconds,
        largeStep: largeStepSeconds,
      })
      if (action === null || action.kind === 'shortcut-help') return
      if (targetClaimsKeys(event.target) || modalDialogOpen(document)) return
      // Claimed even where nothing happens (an image, or a boundary jump),
      // so the page never scrolls under a key the transport owns.
      event.preventDefault()
      if (!hasClock) return
      switch (action.kind) {
        case 'toggle-play':
          if (playing) pause()
          else play()
          break
        case 'step':
          seek(stepTarget(Math.min(time, duration), action.delta, duration))
          break
        case 'jump':
          seek(action.to === 'start' ? 0 : duration)
          break
        case 'jump-boundary':
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, stepSeconds, largeStepSeconds, hasClock, playing, pause, play, seek, time, duration])

  // An image shows at its natural aspect, as large as the frame allows:
  // bound by whichever frame edge it meets first, from its probed
  // dimensions (#137). Without them it falls back to filling the frame
  // with the picture letterboxed inside — natural aspect either way, but
  // the element's own box then says nothing about it.
  const imageStyle = ((): CSSProperties => {
    if (clip.width === undefined || clip.height === undefined || clip.height === 0) {
      return { width: '100%', height: '100%', objectFit: 'contain' }
    }
    return clip.width / clip.height >= aspect
      ? { width: '100%', height: 'auto' }
      : { width: 'auto', height: '100%' }
  })()

  return (
    <div className="preview-player source-preview" data-testid="source-preview">
      {/* The header line names what is being auditioned, with the library's
          kind badge, and carries the way back plus the row's convenience
          actions. Adding keeps the source up: auditioning is usually why
          one is here, and one more Back is cheaper than an unexpected
          switch. */}
      <div className="source-preview-header">
        <span className={`clip-kind clip-kind-${clip.kind}`}>{KIND_LABELS[clip.kind]}</span>
        <span className="source-preview-name" data-testid="source-preview-name" title={clip.name}>
          {clip.name}
        </span>
        <span className="source-preview-actions">
          {onAddToTimeline && (
            <button
              type="button"
              data-testid="source-add"
              aria-label={`Add previewed ${clip.name} to timeline`}
              onClick={() => onAddToTimeline(clip)}
            >
              Add to timeline
            </button>
          )}
          {/* Audio has no picture to layer (#145, #294) — same rule as the row. */}
          {onAddOverlay && clip.kind !== 'audio' && (
            <button
              type="button"
              data-testid="source-add-overlay"
              aria-label={`Add previewed ${clip.name} as overlay`}
              onClick={() => onAddOverlay(clip)}
            >
              Add as overlay
            </button>
          )}
          <button
            type="button"
            data-testid="source-back"
            title="Back to the sequence preview (Esc)"
            onClick={onBack}
          >
            Back to sequence
          </button>
        </span>
      </div>
      <div
        className={expanded ? 'preview-stage preview-stage-expanded' : 'preview-stage'}
        style={{ '--preview-aspect': String(aspect) } as CSSProperties}
      >
        <div className="preview-frame source-preview-frame" data-testid="source-frame">
          {clip.kind === 'video' && (
            <video
              ref={videoRef}
              className="preview-media"
              data-testid="source-video"
              src={clip.url}
              playsInline
              preload="auto"
              onEnded={() => setPlaying(false)}
            />
          )}
          {clip.kind === 'audio' && (
            <>
              {/* The clip's whole waveform on the audio lane's blue (#191,
                  #311's card), so a soundtrack reads as one at a glance;
                  the element beneath it is the clock and the sound. */}
              <div className="source-preview-waveform" data-testid="source-waveform">
                <AudioWaveform
                  url={clip.url}
                  duration={clip.duration}
                  inPoint={0}
                  outPoint={clip.duration}
                  data-testid="source-waveform-svg"
                />
              </div>
              <audio
                ref={audioRef}
                data-testid="source-audio"
                src={clip.url}
                preload="auto"
                onEnded={() => setPlaying(false)}
              />
            </>
          )}
          {clip.kind === 'image' && (
            // Decorative: the header names the clip.
            <img
              className="source-preview-image"
              data-testid="source-image"
              src={clip.url}
              alt=""
              style={imageStyle}
            />
          )}
        </div>
      </div>
      {hasClock && (
        <div className="preview-controls source-preview-controls">
          <button
            type="button"
            aria-label={playing ? 'Pause source' : 'Play source'}
            onClick={playing ? pause : play}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            aria-label="Seek within source"
            min={0}
            max={duration}
            step={0.01}
            value={Math.min(time, duration)}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="preview-position" data-testid="source-position">
            {formatDuration(Math.min(time, duration))} / {formatDuration(duration)}
          </span>
        </div>
      )}
    </div>
  )
}
