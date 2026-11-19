import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// UI-1: no right-click menu, no pinch-zoom gestures
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false })

createRoot(document.getElementById('root')!).render(<App />)
