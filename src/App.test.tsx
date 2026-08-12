import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App shell', () => {
  it('renders the application title', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Browser Video Editor' }),
    ).toBeInTheDocument()
  })

  it('renders the three editor regions the MVP will fill in', () => {
    render(<App />)
    expect(screen.getByRole('region', { name: 'Media library' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument()
  })
})
