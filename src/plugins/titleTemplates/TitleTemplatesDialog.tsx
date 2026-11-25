import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AddMenuDialogProps } from '../../lib/addMenu'
import { textDraw } from '../../lib/exportVideo'
import { drawShapeGroups } from '../../lib/shapes'
import type { ShapeGroup } from '../../lib/shapes'
import { measureTextWidth } from '../../lib/textMeasure'
import type { TextMeasurer } from '../../lib/textMeasure'
import { canPlace, defaultValues, isFieldValid, TEMPLATE_FADE, TITLE_TEMPLATES } from './templates'
import type { TemplateContext, TitleTemplate } from './templates'
import '../../components/dialog.css'
import './TitleTemplatesDialog.css'

/** The gallery previews' box, in CSS px: a frame fits inside it at its own aspect. */
const PREVIEW_BOX = { width: 160, height: 90 }

/** A frame's size inside the preview box, keeping its aspect. */
function previewSize(frame: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(PREVIEW_BOX.width / frame.width, PREVIEW_BOX.height / frame.height)
  return { width: Math.round(frame.width * scale), height: Math.round(frame.height * scale) }
}

/**
 * One template drawn small, at the project's aspect, with its default
 * words: the same routines the export draws shapes and text with, so the
 * gallery shows what will be placed. Drawn after the fade-in, where every
 * element is fully visible.
 */
function TemplatePreview({
  template,
  frameWidth,
  frameHeight,
  measure,
  templateContext,
}: {
  template: TitleTemplate
  frameWidth: number
  frameHeight: number
  measure: TextMeasurer
  templateContext: TemplateContext
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = previewSize({ width: frameWidth, height: frameHeight })
  useEffect(() => {
    const frame = { width: frameWidth, height: frameHeight }
    const canvas = canvasRef.current
    const context = canvas?.getContext?.('2d')
    if (canvas === null || canvas === undefined || context === null || context === undefined) return
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * scale)
    canvas.height = Math.round(size.height * scale)
    const { width, height } = canvas
    const elements = template.build(defaultValues(template, templateContext), frame, measure)
    const time = TEMPLATE_FADE
    // A neutral stand-in for the picture underneath.
    const backdrop = context.createLinearGradient(0, 0, width, height)
    backdrop.addColorStop(0, '#4b6584')
    backdrop.addColorStop(1, '#a5b1c2')
    context.fillStyle = backdrop
    context.fillRect(0, 0, width, height)
    const groups: ShapeGroup[] = elements.shapeGroups.map((group, index) => ({ ...group, id: `g${index}` }))
    drawShapeGroups(context, groups, time, width, height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    elements.texts.forEach((spec, index) => {
      const draw = textDraw({ ...spec, id: `t${index}` }, width, height, time)
      context.font = draw.font
      context.fillStyle = draw.color
      draw.lines.forEach((line, lineIndex) => {
        context.fillText(line, draw.x, draw.firstLineY + lineIndex * draw.lineHeight)
      })
    })
  }, [template, frameWidth, frameHeight, measure, templateContext, size.width, size.height])
  return (
    <canvas
      ref={canvasRef}
      className="title-template-preview"
      data-testid={`title-template-preview-${template.id}`}
      style={{ width: size.width, height: size.height }}
      aria-hidden="true"
    />
  )
}

interface TitleTemplatesDialogProps extends AddMenuDialogProps {
  /** Injectable for tests: jsdom has no canvas to measure with. */
  measure?: TextMeasurer
}

/**
 * Add ▾ › Title template… (#860): the gallery, then the chosen template's
 * words, then Place. Templates are native radio buttons, so the arrow keys
 * move between them and Tab moves on to the fields, with nothing
 * hand-rolled. Enter in a field places, and Escape cancels from anywhere.
 * Hand-rolled modal rather than `<dialog>`, as `ConfirmDialog` is, so focus
 * and Escape behave the same under jsdom.
 */
export function TitleTemplatesDialog({
  frame,
  shapeGroups,
  onPlace,
  onClose,
  measure = measureTextWidth,
}: TitleTemplatesDialogProps) {
  const headingId = useId()
  const fieldId = useId()
  const [templateId, setTemplateId] = useState(TITLE_TEMPLATES[0].id)
  const template = TITLE_TEMPLATES.find((candidate) => candidate.id === templateId) ?? TITLE_TEMPLATES[0]
  // What the templates may read of the timeline, as it was when the dialog
  // opened: the step badge's next number (#868). Fixed while it is open.
  const [context] = useState<TemplateContext>(() => ({ shapeGroups }))
  // Each template keeps what was typed into it while the dialog is open,
  // so looking at another template and coming back loses nothing.
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(TITLE_TEMPLATES.map((candidate) => [candidate.id, defaultValues(candidate, context)])),
  )
  const current = values[template.id]
  const placeable = canPlace(template, current)
  const firstRadioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRadioRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!placeable) return
    onPlace(template.build(current, frame, measure))
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog title-templates-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h3 id={headingId}>Title template</h3>
        <div className="dialog-body">
          <fieldset className="title-templates-gallery">
            <legend>Template</legend>
            {/* The cards scroll inside the dialog, so the fields and Place stay in view (#868). */}
            <div className="title-templates-list" data-testid="title-templates-list">
              {TITLE_TEMPLATES.map((candidate, index) => (
                <label key={candidate.id} className="title-template-option">
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name="title-template"
                    value={candidate.id}
                    checked={candidate.id === template.id}
                    onChange={() => setTemplateId(candidate.id)}
                    // Named for the template alone; the line under it describes it.
                    aria-label={candidate.name}
                    aria-describedby={`${fieldId}-${candidate.id}-description`}
                  />
                  <TemplatePreview
                    template={candidate}
                    frameWidth={frame.width}
                    frameHeight={frame.height}
                    measure={measure}
                    templateContext={context}
                  />
                  <span className="title-template-name">{candidate.name}</span>
                  <span id={`${fieldId}-${candidate.id}-description`} className="title-template-description">
                    {candidate.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="title-templates-fields">
            {template.fields.map((field) => (
              <div key={`${template.id}:${field.key}`} className="title-templates-field">
                <label htmlFor={`${fieldId}-${field.key}`}>
                  {field.label}
                  {field.optional === true ? ' (optional)' : ''}
                </label>
                <input
                  id={`${fieldId}-${field.key}`}
                  {...(field.wholeNumber === undefined
                    ? { type: 'text' }
                    : { type: 'number', min: field.wholeNumber.min, max: field.wholeNumber.max, step: 1 })}
                  aria-invalid={isFieldValid(field, current) ? undefined : true}
                  value={current[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      [template.id]: { ...previous[template.id], [field.key]: event.target.value },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!placeable}>
            Place
          </button>
        </div>
      </form>
    </div>
  )
}
