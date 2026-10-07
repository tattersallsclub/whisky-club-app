import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog } from './ConfirmDialog'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { isTemporaryId } from '../domain/clubRules'

/**
 * Typing the member's name to confirm, rather than a plain popup, is the
 * one extra step deliberately added here, since this is the one action
 * in the whole app with no undo at all. A plain "are you sure" is too
 * easy to tap through on autopilot, this forces a moment of actually
 * reading the name before it disappears for good.
 */
function HardDeleteDialog({ member, onConfirm, onCancel, deleting }) {
  const [typedName, setTypedName] = useState('')
  if (!member) return null
  const matches = typedName.trim() === member.name

  return (
    <div className="dialog-overlay" role="presentation" onClick={onCancel}>
      <div className="dialog-box" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Delete permanently</h2>
        <p>
          This permanently deletes {member.name} and every range and whiskey they ever redeemed. This cannot be
          undone. Type their name exactly to confirm.
        </p>
        <input
          className="hard-delete-input"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder={member.name}
        />
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" disabled={!matches || deleting} onClick={onConfirm}>
            {deleting ? <Spinner /> : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MembersScreen({ onOpenMember, onOpenAddMember, showInactive, onToggleShowInactive }) {
  const { state, setMemberActive, hardDeleteMember } = useClubData()
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState(null)
  const [pendingReactivation, setPendingReactivation] = useState(null)
  const [pendingHardDelete, setPendingHardDelete] = useState(null)

  /**
   * Every one of these always closes its dialog in a finally block, not
   * just after a successful await, a failed request used to leave the
   * dialog open with no visible sign anything had gone wrong. The toast
   * is what actually carries the result now, the dialog closing is just
   * "this attempt is over", success or not.
   */
  const [runRemove, removing] = useAsyncAction(async (member) => {
    try {
      await setMemberActive(member.id, false)
      showToast(`${member.name} removed.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingRemoval(null)
    }
  })

  const [runReactivate, reactivating] = useAsyncAction(async (member) => {
    try {
      await setMemberActive(member.id, true)
      showToast(`${member.name} reactivated.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingReactivation(null)
    }
  })

  const [runHardDelete, hardDeleting] = useAsyncAction(async (member) => {
    try {
      await hardDeleteMember(member.id)
      showToast(`${member.name} permanently deleted.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingHardDelete(null)
    }
  })

  // showInactive is a switch between two views, not an "also show" toggle,
  // checking it should show only the people who left, not everyone at once.
  const visibleMembers = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase()
    return state.members
      .filter((m) => (showInactive ? !m.active : m.active))
      .filter(
        (m) =>
          !normalisedQuery ||
          m.name.toLowerCase().includes(normalisedQuery) ||
          (!isTemporaryId(m.id) && m.id.toLowerCase().includes(normalisedQuery))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.members, showInactive, query])

  return (
    <div className="admin-screen">
      <div className="admin-screen-header">
        <h2>Members</h2>
        <button className="btn btn-primary" onClick={onOpenAddMember}>Add subscription</button>
      </div>

      <label className="toggle-inactive">
        <input type="checkbox" checked={showInactive} onChange={(e) => onToggleShowInactive(e.target.checked)} />
        Show inactive members
      </label>

      <input
        type="search"
        className="search-input"
        placeholder="Search by name or code"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {visibleMembers.length === 0 && <p className="no-results">No members found</p>}

      <ul className="member-admin-list">
        {visibleMembers.map((m) => (
          <li key={m.id} className={m.active ? '' : 'member-inactive'}>
            <button className="member-name-link" onClick={() => onOpenMember(m.id)}>
              {m.name} {!isTemporaryId(m.id) ? `(${m.id})` : <span className="needs-code-tag">needs code</span>}
            </button>
            <div className="member-admin-actions">
              {m.active ? (
                <button className="btn btn-danger btn-small" onClick={() => setPendingRemoval(m)}>
                  Remove
                </button>
              ) : (
                <>
                  <button className="btn btn-secondary btn-small" onClick={() => setPendingReactivation(m)}>
                    Reactivate
                  </button>
                  <button className="btn btn-danger btn-small" onClick={() => setPendingHardDelete(m)}>
                    Delete permanently
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        title="Remove member"
        message={`Are you sure you want to remove ${pendingRemoval?.name}? Their redemption history stays saved and can be reactivated later.`}
        confirmLabel={removing ? <Spinner /> : 'Remove'}
        confirmDisabled={removing}
        onConfirm={() => runRemove(pendingRemoval)}
        onCancel={() => setPendingRemoval(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingReactivation)}
        title="Reactivate member"
        message={`Reactivate ${pendingReactivation?.name}? Their open balance becomes valid again.`}
        confirmLabel={reactivating ? <Spinner /> : 'Reactivate'}
        confirmDisabled={reactivating}
        onConfirm={() => runReactivate(pendingReactivation)}
        onCancel={() => setPendingReactivation(null)}
      />

      <HardDeleteDialog
        member={pendingHardDelete}
        deleting={hardDeleting}
        onConfirm={() => runHardDelete(pendingHardDelete)}
        onCancel={() => setPendingHardDelete(null)}
      />
    </div>
  )
}