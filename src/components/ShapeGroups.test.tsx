import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { ADD_SHAPES, ADD_TEXT, chooseFromAddMenu } from '../test/timelineMenu'

/**
 * The Shapes section (#683, the approved design #681): Add ▾ › Shape group,
 * the group row's fields, and the section's place between Overlays and Text.
 * App-level, because adding reads the preview's playhead and the px fields
 * read the preview's output frame — both cross the component boundary.
 */

const group = (index = 1) => `shape group at position ${index}`
const shape = (kind: string, index: number, groupIndex = 1) =>
  `${kind} ${index} of ${group(groupIndex)}`

describe('Arrows in shape groups (#684)', () => {
  it('+ Add shape › Arrow adds an arrow with tail, tip, border and heads fields, and no fill', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arrow' }))
    const arrow = shape('Arrow', 2)
    expect(screen.getByRole('listitem', { name: arrow })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Shape groups' })
    expect(within(list).getByText('Ellipse + Arrow', { selector: '.clip-name' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: `Tail x of ${arrow} (0 to 1)` })).toHaveValue(0.35)
    expect(screen.getByRole('spinbutton', { name: `Tail y of ${arrow} (0 to 1)` })).toHaveValue(0.5)
    expect(screen.getByRole('spinbutton', { name: `Tip x of ${arrow} (0 to 1)` })).toHaveValue(0.65)
    expect(screen.getByRole('spinbutton', { name: `Tip y of ${arrow} (0 to 1)` })).toHaveValue(0.5)
    // It took the last shape's border, and draws no fill.
    expect(screen.getByLabelText(`Border colour of ${arrow}`)).toHaveValue('#e53935')
    expect(screen.queryByLabelText(`Fill colour of ${arrow}`)).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: `Left edge of ${arrow} (0 to 1)` })).toBeNull()
    expect(screen.getByRole('combobox', { name: `Arrow heads of ${arrow}` })).toHaveValue('tip')
    expect(screen.getByRole('combobox', { name: `Head size of ${arrow}` })).toHaveValue('medium')
  })

  it('switches heads to both ends and to none, each one undoable edit; a line has no head size', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arrow' }))
    const arrow = shape('Arrow', 2)
    const heads = () => screen.getByRole('combobox', { name: `Arrow heads of ${arrow}` })
    await userEvent.selectOptions(heads(), 'both')
    expect(heads()).toHaveValue('both')
    await userEvent.selectOptions(heads(), 'none')
    expect(heads()).toHaveValue('none')
    expect(screen.queryByRole('combobox', { name: `Head size of ${arrow}` })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(heads()).toHaveValue('both')
    expect(screen.getByRole('combobox', { name: `Head size of ${arrow}` })).toBeInTheDocument()
  })

  it('warns that an arrow with no border is invisible, whatever its fill', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arrow' }))
    const arrow = shape('Arrow', 2)
    const thickness = screen.getByRole('spinbutton', { name: `Border thickness of ${arrow} in pixels` })
    await userEvent.clear(thickness)
    await userEvent.type(thickness, '0')
    await userEvent.tab()
    expect(within(screen.getByRole('listitem', { name: arrow })).getByRole('note')).toHaveTextContent(
      'This arrow is invisible',
    )
  })
})

describe('Shape-group row actions (#687)', () => {
  const field = (label: string, index = 1) =>
    screen.getByRole('spinbutton', { name: `${label} of ${group(index)} in seconds` })
  const setField = async (label: string, value: string, index = 1) => {
    await userEvent.clear(field(label, index))
    await userEvent.type(field(label, index), value)
    await userEvent.tab()
  }
  const rowAction = async (index: number, item: string) => {
    await userEvent.click(screen.getByRole('button', { name: `More actions for ${group(index)}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: item }))
  }
  const names = () =>
    within(screen.getByRole('list', { name: 'Shape groups' }))
      .getAllByText(/./, { selector: '.clip-name' })
      .map((each) => each.textContent)

  it('Duplicate adds a copy starting at the original end, with equal shapes and fades, as one undo step', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rectangle' }))
    await setField('Fade-in', '0.5')
    const start = Number((field('Start time') as HTMLInputElement).value)
    const duration = Number((field('Duration') as HTMLInputElement).value)

    await rowAction(1, 'Duplicate')
    expect(field('Start time', 2)).toHaveValue(start + duration)
    expect(field('Duration', 2)).toHaveValue(duration)
    expect(field('Fade-in', 2)).toHaveValue(0.5)
    expect(screen.getByRole('listitem', { name: shape('Ellipse', 1, 2) })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: shape('Rectangle', 2, 2) })).toBeInTheDocument()
    expect(names()).toEqual(['Ellipse + Rectangle', 'Ellipse + Rectangle'])

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('spinbutton', { name: `Start time of ${group(2)} in seconds` })).toBeNull()
  })

  it('Paste settings carries timing and fades onto another group and leaves its shapes', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await rowAction(1, 'Duplicate')
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group(2)}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arrow' }))
    await setField('Duration', '5', 2)
    await setField('Fade-out', '1', 2)
    const start2 = Number((field('Start time', 2) as HTMLInputElement).value)

    await rowAction(2, 'Copy settings')
    await rowAction(1, 'Paste settings')
    const dialog = screen.getByRole('dialog', { name: `Paste settings onto ${group(1)}?` })
    expect(within(dialog).getByRole('checkbox', { name: 'Timing and fades' })).toBeChecked()
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    expect(field('Start time', 1)).toHaveValue(start2)
    expect(field('Duration', 1)).toHaveValue(5)
    expect(field('Fade-out', 1)).toHaveValue(1)
    // Its shapes are its own: one ellipse, not the source's ellipse + arrow.
    expect(names()[0]).toBe('Ellipse')
    expect(screen.queryByRole('listitem', { name: shape('Arrow', 2, 1) })).toBeNull()
  })

  it('Rename… sets the group name, and emptying it returns to the name from its shapes', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    expect(names()).toEqual(['Ellipse'])

    await rowAction(1, 'Rename…')
    const input = screen.getByRole('textbox', { name: `New name for ${group()}` })
    expect(input).toHaveValue('Ellipse')
    await userEvent.clear(input)
    await userEvent.type(input, 'Callouts{Enter}')
    expect(names()).toEqual(['Callouts'])
    // A custom name stays put while the shapes change.
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arrow' }))
    expect(names()).toEqual(['Callouts'])

    await rowAction(1, 'Rename…')
    await userEvent.clear(screen.getByRole('textbox', { name: `New name for ${group()}` }))
    await userEvent.keyboard('{Enter}')
    expect(names()).toEqual(['Ellipse + Arrow'])
  })
})

describe('Shapes section (#683)', () => {
  it('Add ▾ › Shape group adds one red, transparent-centred ellipse at the playhead for 3 s', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)

    const list = screen.getByRole('list', { name: 'Shape groups' })
    expect(within(list).getAllByRole('listitem', { name: undefined }).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Shapes' })).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', { name: `Start time of ${group()} in seconds` }),
    ).toHaveValue(0)
    expect(screen.getByRole('spinbutton', { name: `Duration of ${group()} in seconds` })).toHaveValue(3)
    const ellipse = shape('Ellipse', 1)
    expect(screen.getByRole('listitem', { name: ellipse })).toBeInTheDocument()
    expect(screen.getByLabelText(`Border colour of ${ellipse}`)).toHaveValue('#e53935')
    expect(
      screen.getByRole('spinbutton', { name: `Border opacity of ${ellipse} (percent)` }),
    ).toHaveValue(100)
    expect(
      screen.getByRole('spinbutton', { name: `Fill opacity of ${ellipse} (percent)` }),
    ).toHaveValue(0)
    // Thickness in px at the current output frame: an empty project has the
    // 640×360 fallback frame, where 6/1080 of the shorter side is 2 px.
    expect(
      screen.getByRole('spinbutton', { name: `Border thickness of ${ellipse} in pixels` }),
    ).toHaveValue(2)
    // A rectangle-only field is absent on an ellipse.
    expect(screen.queryByRole('spinbutton', { name: `Corner radius of ${ellipse} in pixels` })).toBeNull()
  })

  it('sits between Overlays and Text, and is named for its contents', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_TEXT)
    await chooseFromAddMenu(ADD_SHAPES)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(headings.indexOf('Shapes')).toBeGreaterThan(-1)
    expect(headings.indexOf('Shapes')).toBeLessThan(headings.indexOf('Text'))

    const list = screen.getByRole('list', { name: 'Shape groups' })
    expect(within(list).getByText('Ellipse', { selector: '.clip-name' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rectangle' }))
    expect(within(list).getByText('Ellipse + Rectangle', { selector: '.clip-name' })).toBeInTheDocument()
    // The new rectangle has its corner-radius field, and took the last
    // shape's style.
    const rectangle = shape('Rectangle', 2)
    expect(
      screen.getByRole('spinbutton', { name: `Corner radius of ${rectangle} in pixels` }),
    ).toHaveValue(0)
    expect(screen.getByLabelText(`Border colour of ${rectangle}`)).toHaveValue('#e53935')
  })

  it('edits a shape field as one undoable edit, and warns about an invisible shape', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    const ellipse = shape('Ellipse', 1)
    const opacity = screen.getByRole('spinbutton', { name: `Border opacity of ${ellipse} (percent)` })
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.clear(opacity)
    await userEvent.type(opacity, '0')
    await userEvent.tab()
    expect(opacity).toHaveValue(0)
    // No border and no fill: the row explains the empty-looking group.
    expect(screen.getByRole('note')).toHaveTextContent('This shape is invisible')

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.getByRole('spinbutton', { name: `Border opacity of ${ellipse} (percent)` })).toHaveValue(100)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('removes a shape only while the group holds another, and removes the group after confirming', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    // The only shape cannot be removed: a group always holds one.
    expect(screen.queryByRole('button', { name: `Remove ${shape('Ellipse', 1)}` })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: `Add a shape to ${group()}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ellipse' }))
    await userEvent.click(screen.getByRole('button', { name: `Remove ${shape('Ellipse', 2)}` }))
    expect(screen.queryByRole('listitem', { name: shape('Ellipse', 2) })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: `Remove ${group()} from timeline` }))
    const dialog = screen.getByRole('dialog', { name: `Remove ${group()}?` })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('list', { name: 'Shape groups' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Shapes' })).toBeNull()
  })
})
