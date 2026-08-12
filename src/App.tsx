import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Browser Video Editor</h1>
        <p className="tagline">Import, arrange, trim, preview, export — all in your browser.</p>
      </header>
      <main className="app-main">
        <section className="panel" aria-label="Media library">
          <h2>Media Library</h2>
          <p className="placeholder">Clip import is coming soon.</p>
        </section>
        <section className="panel" aria-label="Preview">
          <h2>Preview</h2>
          <p className="placeholder">Playback preview is coming soon.</p>
        </section>
        <section className="panel panel-wide" aria-label="Timeline">
          <h2>Timeline</h2>
          <p className="placeholder">Clip arrangement is coming soon.</p>
        </section>
      </main>
    </div>
  )
}

export default App
