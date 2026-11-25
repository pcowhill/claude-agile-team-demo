import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginManager } from './PluginManager'
import { PluginRuntime } from '../lib/plugins'
import type { PluginModule, PluginSpec } from '../lib/plugins'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import type { TimelineState } from '../lib/timeline'

const noStorage = null

function spec(id: string, overrides: Partial<PluginSpec> = {}): PluginSpec {
  return {
    id,
    name: `${id} plugin`,
    description: `Adds the ${id} things.`,
    version: '1.2.3',
    load: () => Promise.resolve<PluginModule>({ activate: () => () => {} }),
    ...overrides,
  }
}

/** A project that uses the 'used' fixture plugin `count` times (#953). */
function usedSpec(count: number): PluginSpec {
  return spec('used', {
    projectUses: {
      count: (_library, timeline) => ({
        count: timeline.entries.length === 0 ? 0 : count,
        what: count === 1 ? '1 widget' : `${count} widgets`,
      }),
      whileDisabled: 'while the plugin is off, a widget shows as a box.',
    },
  })
}

const library: MediaLibraryState = { clips: [], failures: [] }
const usingTimeline = { entries: [{ id: 'e1', clipId: 'c1' }] } as unknown as TimelineState
const emptyProject: TimelineState = { entries: [] }

async function openWithEnabled(runtime: PluginRuntime, timeline: TimelineState) {
  await Promise.all(runtime.list().map((plugin) => runtime.enable(plugin.id)))
  const user = userEvent.setup()
  render(<PluginManager runtime={runtime} library={library} timeline={timeline} />)
  await user.click(screen.getByRole('button', { name: 'Plugins…' }))
  return user
}

describe('PluginManager: disabling a plugin the project uses asks first (#953)', () => {
  it('asks, with the count and how the uses show, and leaves the plugin enabled until answered', async () => {
    const runtime = new PluginRuntime([usedSpec(2)], noStorage)
    const user = await openWithEnabled(runtime, usingTimeline)

    await user.click(screen.getByRole('button', { name: 'Disable used plugin' }))
    const confirm = screen.getByRole('dialog', { name: 'Disable used plugin?' })
    expect(confirm).toHaveTextContent(
      'This project uses used plugin 2 times: 2 widgets. Disabling removes nothing: while the plugin is off, a widget shows as a box.',
    )
    expect(runtime.isEnabled('used')).toBe(true)
    // Focus starts on the safe action.
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('Disable disables the plugin and returns focus to its row in the Plugins dialog', async () => {
    const runtime = new PluginRuntime([usedSpec(1)], noStorage)
    const user = await openWithEnabled(runtime, usingTimeline)

    await user.click(screen.getByRole('button', { name: 'Disable used plugin' }))
    const confirm = screen.getByRole('dialog', { name: 'Disable used plugin?' })
    expect(confirm).toHaveTextContent('This project uses used plugin once: 1 widget.')
    await user.click(within(confirm).getByRole('button', { name: 'Disable' }))

    expect(runtime.isEnabled('used')).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Disable used plugin?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable used plugin' })).toHaveFocus()
  })

  it('Cancel, Escape and a click on its backdrop each leave the plugin enabled and the Plugins dialog open', async () => {
    const runtime = new PluginRuntime([usedSpec(3)], noStorage)
    const user = await openWithEnabled(runtime, usingTimeline)
    const disableButton = screen.getByRole('button', { name: 'Disable used plugin' })

    await user.click(disableButton)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Disable used plugin?' })).not.toBeInTheDocument()
    expect(disableButton).toHaveFocus()

    await user.click(disableButton)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Disable used plugin?' })).not.toBeInTheDocument()
    // Escape answered the confirmation only: the Plugins dialog stays.
    expect(screen.getByRole('dialog', { name: 'Plugins' })).toBeInTheDocument()
    expect(disableButton).toHaveFocus()

    await user.click(disableButton)
    const overlay = screen.getByRole('dialog', { name: 'Disable used plugin?' }).parentElement!
    await user.click(overlay)
    expect(screen.queryByRole('dialog', { name: 'Disable used plugin?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Plugins' })).toBeInTheDocument()

    expect(runtime.isEnabled('used')).toBe(true)
    // With the confirmation gone, Escape closes the Plugins dialog again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Plugins' })).not.toBeInTheDocument()
  })

  it('disables at once when the project does not use the plugin, or the plugin has no count', async () => {
    const runtime = new PluginRuntime([usedSpec(2), spec('formats')], noStorage)
    const user = await openWithEnabled(runtime, emptyProject)

    await user.click(screen.getByRole('button', { name: 'Disable used plugin' }))
    expect(runtime.isEnabled('used')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Disable formats plugin' }))
    expect(runtime.isEnabled('formats')).toBe(false)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('disables at once without a project to ask about, as before #953', async () => {
    const runtime = new PluginRuntime([usedSpec(2)], noStorage)
    await runtime.enable('used')
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    await user.click(screen.getByRole('button', { name: 'Disable used plugin' }))
    expect(runtime.isEnabled('used')).toBe(false)
  })
})

describe('PluginManager (#197)', () => {
  it('opens the modal and lists every plugin with name, version, and description', async () => {
    const runtime = new PluginRuntime([spec('alpha'), spec('beta')], noStorage)
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)

    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    expect(screen.getByRole('dialog', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByText('alpha plugin')).toBeInTheDocument()
    expect(screen.getByText('beta plugin')).toBeInTheDocument()
    expect(screen.getAllByText('v1.2.3')).toHaveLength(2)
    expect(screen.getByText('Adds the alpha things.')).toBeInTheDocument()
  })

  it('says so when the build ships no plugins', async () => {
    const runtime = new PluginRuntime([], noStorage)
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    expect(screen.getByText('No plugins are available in this build.')).toBeInTheDocument()
  })

  it('enables a plugin (toggle flips to Disable) and disables it again', async () => {
    let active = false
    const runtime = new PluginRuntime(
      [
        spec('alpha', {
          load: () =>
            Promise.resolve({
              activate: () => {
                active = true
                return () => {
                  active = false
                }
              },
            }),
        }),
      ],
      noStorage,
    )
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))

    await user.click(screen.getByRole('button', { name: 'Enable alpha plugin' }))
    const disableToggle = await screen.findByRole('button', { name: 'Disable alpha plugin' })
    expect(active).toBe(true)

    await user.click(disableToggle)
    expect(await screen.findByRole('button', { name: 'Enable alpha plugin' })).toBeInTheDocument()
    expect(active).toBe(false)
  })

  it('shows the loading state while the chunk downloads', async () => {
    let resolveLoad: (module: PluginModule) => void
    const runtime = new PluginRuntime(
      [
        spec('alpha', {
          load: () =>
            new Promise<PluginModule>((resolve) => {
              resolveLoad = resolve
            }),
        }),
      ],
      noStorage,
    )
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))

    await user.click(screen.getByRole('button', { name: 'Enable alpha plugin' }))
    const pending = screen.getByRole('button', { name: 'Enable alpha plugin' })
    expect(pending).toHaveTextContent('Enabling…')
    expect(pending).toBeDisabled()

    resolveLoad!({ activate: () => () => {} })
    expect(await screen.findByRole('button', { name: 'Disable alpha plugin' })).toBeInTheDocument()
  })

  it('reports a failed enable on the row and the toggle retries', async () => {
    let attempts = 0
    const runtime = new PluginRuntime(
      [
        spec('alpha', {
          load: () => {
            attempts++
            if (attempts === 1) return Promise.reject(new Error('chunk unreachable'))
            return Promise.resolve<PluginModule>({ activate: () => () => {} })
          },
        }),
      ],
      noStorage,
    )
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))

    await user.click(screen.getByRole('button', { name: 'Enable alpha plugin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not enable: chunk unreachable',
    )

    await user.click(screen.getByRole('button', { name: 'Enable alpha plugin' }))
    expect(await screen.findByRole('button', { name: 'Disable alpha plugin' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Escape and the Close button dismiss the modal', async () => {
    const runtime = new PluginRuntime([spec('alpha')], noStorage)
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)

    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reflects a plugin enabled outside the modal (startup restore)', async () => {
    const runtime = new PluginRuntime([spec('alpha')], noStorage)
    const user = userEvent.setup()
    render(<PluginManager runtime={runtime} />)
    await user.click(screen.getByRole('button', { name: 'Plugins…' }))
    expect(screen.getByRole('button', { name: 'Enable alpha plugin' })).toBeInTheDocument()

    await runtime.enable('alpha')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Disable alpha plugin' })).toBeInTheDocument(),
    )
  })
})
