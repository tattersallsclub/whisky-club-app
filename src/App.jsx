import { useEffect, useMemo, useState } from 'react'
import { PinGate } from './components/PinGate'
import { AppShell } from './components/AppShell'
import { MemberPortalScreen } from './components/MemberPortalScreen'
import { DataProvider } from './context/DataContext'
import { ToastProvider } from './context/ToastContext'
import { GoogleSheetsRepository } from './data/GoogleSheetsRepository'
import { LocalCacheRepository } from './data/LocalCacheRepository'
import { APPS_SCRIPT_WEB_APP_URL } from './config'

/**
 * The repository can only be built once a real session token exists, so
 * it lives in this small wrapper rather than at the very top of the
 * tree, and is rebuilt (via the token in its dependency array) if that
 * token ever changes, for example after a fresh login.
 */
function AuthenticatedApp({ token }) {
  const repository = useMemo(() => {
    const remote = new GoogleSheetsRepository(APPS_SCRIPT_WEB_APP_URL, token)
    return new LocalCacheRepository(remote)
  }, [token])

  return (
    <DataProvider repository={repository}>
      <AppShell />
    </DataProvider>
  )
}

/**
 * The public member portal, reached through a QR code at the bar, is
 * checked for first and returned on its own, deliberately outside the
 * PIN gate and outside the shared data context. It only ever looks up
 * one person's own data on demand, it has no reason to load the whole
 * club's state the way the staff app does, and it never needs a login
 * token, its two backend actions are public by design. GitHub Pages
 * cannot serve a real second URL path reliably (a direct visit to it
 * would 404), so this is a hash instead, the same index.html loads
 * either way, only what appears after # decides which screen shows.
 *
 * The hash is tracked in state, not read once and forgotten, because
 * changing only the fragment of a URL does not reload the page, the
 * browser treats it as a same document navigation. Without listening
 * for that change explicitly, an already open tab would never notice it
 * was told to switch screens.
 */
export default function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    function handleHashChange() {
      setHash(window.location.hash)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (hash === '#my-club') {
    return (
      <ToastProvider>
        <MemberPortalScreen />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <PinGate>{(token) => <AuthenticatedApp token={token} />}</PinGate>
    </ToastProvider>
  )
}