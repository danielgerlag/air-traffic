import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { ProjectView } from './pages/ProjectView'
import { Settings } from './pages/Settings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/ui/toast'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-zinc-950 text-zinc-100">
            <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur">
              <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-14 items-center justify-between">
                  <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
                    <span className="text-emerald-400">⚡</span> Air Traffic Console
                  </Link>
                  <div className="flex items-center gap-4">
                    <Link to="/" className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">
                      Dashboard
                    </Link>
                    <Link to="/settings" className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">
                      Settings
                    </Link>
                  </div>
                </div>
              </div>
            </nav>
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/project/:name" element={<ProjectView />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  )
}
