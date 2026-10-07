import { useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { HomeScreen } from './HomeScreen'
import { MembersScreen } from './MembersScreen'
import { WhiskeysScreen } from './WhiskeysScreen'
import { RangesScreen } from './RangesScreen'
import { MemberDetailScreen } from './MemberDetailScreen'
import { AddMemberScreen } from './AddMemberScreen'
import { NotificationsScreen } from './NotificationsScreen'
import { BackupButton } from './BackupButton'
import { Spinner } from './Spinner'

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'members', label: 'Members' },
  { id: 'whiskeys', label: 'Whiskeys' },
  { id: 'ranges', label: 'Ranges' },
]

/**
 * A small hand written outline instead of an emoji or an icon library,
 * same reasoning as the avatar icon on the Ranges tabs, one glyph does
 * not justify a new dependency, and a plain stroke outline reads as more
 * minimal than an emoji at this size anyway.
 */
function BellIcon() {
  return (
    <svg className="bell-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3c-3.3 0-6 2.7-6 6v3.5c0 .6-.2 1.2-.6 1.7L4 16h16l-1.4-1.8c-.4-.5-.6-1.1-.6-1.7V9c0-3.3-2.7-6-6-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Navigation is a small state machine instead of a router because every
 * screen here is reached from inside the app itself, never from an
 * external link, so there is nothing a router would add beyond
 * complexity.
 */
export function AppShell() {
  const { loading, error, servedFromCache, reload, state } = useClubData()
  const { showToast, updateToast } = useToast()
  const [screen, setScreen] = useState({ tab: 'home' })
  const [showInactiveMembers, setShowInactiveMembers] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const pendingRequestCount = state.purchaseRequests.length

  /**
   * The old "Showing locally saved data" banner used to also flash
   * during a perfectly normal sync, because the app always shows cache
   * first by design. That banner now only reflects a genuine ongoing
   * problem (handled where it is rendered below), this toast is the
   * actual feedback for the button press itself, shown over everything
   * rather than blocking the screen, since a sync should never stop
   * someone from keep using the app while it runs.
   */
  async function handleSync() {
    setSyncing(true)
    const toastId = showToast('Synchronizing data with database...', 'syncing', null)
    const result = await reload()
    if (result.success) {
      updateToast(toastId, 'Database synchronized.', 'success')
    } else {
      updateToast(toastId, 'Could not reach the database, showing saved data.', 'error')
    }
    setSyncing(false)
  }

  function openMember(memberId) {
    setScreen({ tab: 'memberDetail', memberId, returnTab: screen.tab })
  }

  function openAddMember(rangeId) {
    setScreen({ tab: 'addMember', rangeId, returnTab: screen.tab === 'addMember' ? 'home' : screen.tab })
  }

  function openRange(rangeId) {
    setScreen({ tab: 'ranges', rangeId })
  }

  function openNotifications() {
    setScreen({ tab: 'notifications', returnTab: screen.tab === 'notifications' ? 'home' : screen.tab })
  }

  function selectTab(tabId) {
    setScreen({ tab: tabId })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Whisky Club</h1>
        <div className="app-header-actions">
          <BackupButton />
          <button
            className="notification-bell"
            onClick={openNotifications}
            aria-label={`Notifications, ${pendingRequestCount} pending`}
          >
            <BellIcon />
            {pendingRequestCount > 0 && <span className="notification-badge">{pendingRequestCount}</span>}
          </button>
          <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? <Spinner /> : 'Synchronize database'}
          </button>
        </div>
      </header>

      {servedFromCache && (
        <div className="banner banner-warning">
          Showing locally saved data. Check the connection to sync with the spreadsheet.
        </div>
      )}
      {error && <div className="banner banner-error">Failed to load data: {error}</div>}

      <nav className="app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`app-tab ${screen.tab === tab.id ? 'app-tab-active' : ''}`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-content">
        {loading ? (
          <p className="loading-indicator">Loading...</p>
        ) : (
          <>
            {screen.tab === 'home' && (
              <HomeScreen
                onOpenMember={openMember}
                onOpenAddMember={() => openAddMember(null)}
                onOpenRange={openRange}
              />
            )}
            {screen.tab === 'members' && (
              <MembersScreen
                onOpenMember={openMember}
                onOpenAddMember={() => openAddMember(null)}
                showInactive={showInactiveMembers}
                onToggleShowInactive={setShowInactiveMembers}
              />
            )}
            {screen.tab === 'whiskeys' && <WhiskeysScreen />}
            {screen.tab === 'ranges' && (
              <RangesScreen initialRangeId={screen.rangeId} onOpenAddMember={openAddMember} onOpenMember={openMember} />
            )}
            {screen.tab === 'memberDetail' && (
              <MemberDetailScreen
                memberId={screen.memberId}
                onBack={() => selectTab(screen.returnTab || 'home')}
                onIdentityChanged={(newId) => setScreen({ ...screen, memberId: newId })}
              />
            )}
            {screen.tab === 'addMember' && (
              <AddMemberScreen
                initialRangeId={screen.rangeId}
                onDone={() => setScreen({ tab: screen.returnTab || 'home', rangeId: screen.rangeId })}
              />
            )}
            {screen.tab === 'notifications' && (
              <NotificationsScreen onBack={() => selectTab(screen.returnTab || 'home')} />
            )}
          </>
        )}
      </main>
    </div>
  )
}