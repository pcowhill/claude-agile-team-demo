import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginManager } from './PluginManager'
import { PluginRuntime } from '../lib/plugins'
import type { PluginModule, PluginSpec } from '../lib/plugins'

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
