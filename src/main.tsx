import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { pluginRuntime } from './plugins/runtime.ts'

// Re-activate the plugins persisted as enabled (#197). Deliberately not
// awaited: first paint must not wait on plugin chunks. The UI reflects each
// plugin as it activates (subscriptions), and the one path that must see the
// restored state — opening a project and checking its plugin dependencies —
// awaits the same memoized promise inside ProjectControls.
void pluginRuntime.restore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
