import { useMemo } from 'react'
import { AppProvider, useApp } from './state.tsx'
import { link, useRoute } from './router.ts'
import { verifyList } from './lib/deadlines.ts'
import { Dashboard } from './routes/Dashboard.tsx'
import { RunView, SearchHome } from './routes/Search.tsx'
import { TrackerDetail, TrackerList } from './routes/Tracker.tsx'
import { VerifyQueue } from './routes/Verify.tsx'
import { DraftsDetail, DraftsHome } from './routes/Drafts.tsx'

const TABS = [
  ['', 'Dashboard'],
  ['search', 'Search'],
  ['tracker', 'Tracker'],
  ['verify', 'Verify'],
  ['drafts', 'Drafts'],
] as const

function Shell() {
  const { opps, loading, loadError, reload } = useApp()
  const route = useRoute()
  const verifyCount = useMemo(() => verifyList(opps).length, [opps])
  const [section = '', arg] = route

  let page
  if (loading) page = <div className="empty">Loading...</div>
  else if (loadError) {
    page = (
      <div className="card">
        <h2>Cannot reach the local API</h2>
        <p>{loadError}</p>
        <p className="muted">
          Start everything with <span className="mono">npm run dev</span> (the API runs on port 5174 and the page on 5173).
        </p>
        <button className="btn" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    )
  } else if (section === 'search') page = arg ? <RunView key={arg} runId={arg} /> : <SearchHome />
  else if (section === 'tracker') page = arg ? <TrackerDetail id={arg} /> : <TrackerList />
  else if (section === 'verify') page = <VerifyQueue />
  else if (section === 'drafts') page = arg ? <DraftsDetail oppId={arg} /> : <DraftsHome />
  else page = <Dashboard />

  return (
    <>
      <header className="topbar">
        <nav className="topbar-in">
          <span className="brand">Application Tracker</span>
          {TABS.map(([path, label]) => (
            <a key={path} href={path ? link(path) : '#/'} className={`tab ${section === path ? 'active' : ''}`}>
              {label}
              {path === 'verify' && verifyCount > 0 ? <span className="badge warn" style={{ marginLeft: 6 }}>{verifyCount}</span> : null}
            </a>
          ))}
        </nav>
      </header>
      <main className="page">{page}</main>
    </>
  )
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
