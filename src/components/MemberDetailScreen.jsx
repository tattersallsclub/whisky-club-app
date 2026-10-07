import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { MembershipCard } from './MembershipCard'
import { ConfirmDialog } from './ConfirmDialog'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { isTemporaryId, isValidMemberCode } from '../domain/clubRules'

const SORT_OPTIONS = [
  { value: 'range', label: 'Range' },
  { value: 'dateJoined', label: 'Date joined' },
]

/**
 * Sorting by range uses the numeric start of the range rather than a
 * plain string compare, because "11-20" would otherwise sort before
 * "2-10" alphabetically, which is not the order a person expects.
 */
function rangeStart(rangeId) {
  return Number(rangeId.split('-')[0])
}

/**
 * onIdentityChanged exists because this screen is opened with a specific
 * member id, but editing the code replaces that id. Without telling the
 * parent screen the new id, the very next render would look up the old
 * id, find nothing, and show "member not found" right after a successful
 * save.
 */
export function MemberDetailScreen({ memberId, onBack, onIdentityChanged }) {
  const { state, toggleRedemption, updateMemberIdentity, renewMembership, setMemberActive, deleteMembershipRange } = useClubData()
  const { showToast } = useToast()
  const [sortBy, setSortBy] = useState('range')
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftCode, setDraftCode] = useState('')
  const [pendingSave, setPendingSave] = useState(null)
  const [editError, setEditError] = useState(null)
  const [pendingActiveTarget, setPendingActiveTarget] = useState(null)

  const member = state.members.find((m) => m.id === memberId)

  const whiskeySlotsByNumber = useMemo(
    () => new Map(state.whiskeySlots.map((s) => [s.number, s])),
    [state.whiskeySlots]
  )

  const memberships = useMemo(() => {
    const filtered = state.rangeMemberships.filter((m) => m.memberId === memberId)
    return [...filtered].sort((a, b) =>
      sortBy === 'dateJoined'
        ? new Date(a.activationDate) - new Date(b.activationDate)
        : rangeStart(a.rangeId) - rangeStart(b.rangeId)
    )
  }, [state.rangeMemberships, memberId, sortBy])

  /**
   * Defined before the "member not found" early return below, even
   * though they only ever run after a button tap that could not exist
   * without a member, because hooks can never follow a conditional
   * return, only the closures inside them are allowed to assume member
   * exists by the time they actually execute.
   */
  const [runSave, saving] = useAsyncAction(async (toSave) => {
    try {
      const result = await updateMemberIdentity(memberId, toSave.name, toSave.code)
      setPendingSave(null)
      setEditing(false)
      showToast('Member updated.', 'success')
      if (result.newId !== memberId) {
        onIdentityChanged(result.newId)
      }
    } catch (err) {
      setPendingSave(null)
      setEditError(err.message)
      showToast(err.message, 'error')
    }
  })

  const [runActiveToggle, togglingActive] = useAsyncAction(async (member, makeActive) => {
    try {
      await setMemberActive(member.id, makeActive)
      showToast(makeActive ? `${member.name} reactivated.` : `${member.name} removed.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingActiveTarget(null)
    }
  })

  if (!member) {
    return (
      <div className="member-detail">
        <p>Member not found.</p>
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
      </div>
    )
  }

  function startEditing() {
    setDraftName(member.name)
    setDraftCode(isTemporaryId(member.id) ? '' : member.id)
    setEditError(null)
    setEditing(true)
  }

  function requestSave() {
    if (!draftCode.trim()) {
      setEditError('Code cannot be empty, it is used as the member id.')
      return
    }
    if (!isValidMemberCode(draftCode)) {
      setEditError('Code must be 1 to 2 letters followed by up to 3 numbers, like A213 or M1.')
      return
    }
    setEditError(null)
    setPendingSave({ name: draftName.trim(), code: draftCode.trim() })
  }

  return (
    <div className="member-detail">
      <div className="member-detail-header">
        {editing ? (
          <div className="edit-member-form">
            <label>
              Name
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </label>
            <label>
              Code
              <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} />
            </label>
            {editError && <p className="form-error">{editError}</p>}
            <div className="form-actions">
              <button className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary btn-small" onClick={requestSave}>Save</button>
            </div>
          </div>
        ) : (
          <div>
            <h2>{member.name}</h2>
            <p className="member-code">
              {!isTemporaryId(member.id) ? member.id : 'No code on file'}
              {!member.active && <span className="inactive-tag">inactive</span>}
            </p>
            <div className="member-detail-actions">
              <button className="btn btn-secondary btn-small" onClick={startEditing}>Edit member</button>
              <button
                className="btn btn-danger btn-small"
                onClick={() => setPendingActiveTarget(!member.active)}
                disabled={togglingActive}
              >
                {member.active ? 'Remove member' : 'Reactivate member'}
              </button>
            </div>
          </div>
        )}
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
      </div>

      {memberships.length > 1 && (
        <label className="sort-control">
          Order by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}

      {memberships.length === 0 && <p className="all-clear">This member has no ranges yet.</p>}

      {memberships.map((membership) => (
        <MembershipCard
          key={membership.id}
          membership={membership}
          whiskeySlotsByNumber={whiskeySlotsByNumber}
          onToggle={(membershipId, slotNumber, consumed) => toggleRedemption(membershipId, slotNumber, consumed)}
          onRenew={renewMembership}
          onDelete={deleteMembershipRange}
          showMemberName={false}
        />
      ))}

      <ConfirmDialog
        open={Boolean(pendingSave)}
        title="Change member code"
        message={
          pendingSave && pendingSave.code !== member.id
            ? `Changing the code from ${member.id} to ${pendingSave.code} updates this member's id everywhere, including on all ${memberships.length} of their ranges. Continue?`
            : 'Save these changes?'
        }
        confirmLabel={saving ? <Spinner /> : 'Save'}
        confirmDisabled={saving}
        onConfirm={() => runSave(pendingSave)}
        onCancel={() => setPendingSave(null)}
      />

      <ConfirmDialog
        open={pendingActiveTarget !== null}
        title={pendingActiveTarget ? 'Reactivate member' : 'Remove member'}
        message={
          pendingActiveTarget
            ? `Reactivate ${member.name}? Their open balance becomes valid again.`
            : `Remove ${member.name}? Their redemption history stays saved and can be reactivated later.`
        }
        confirmLabel={togglingActive ? <Spinner /> : pendingActiveTarget ? 'Reactivate' : 'Remove'}
        confirmDisabled={togglingActive}
        onConfirm={() => runActiveToggle(member, pendingActiveTarget)}
        onCancel={() => setPendingActiveTarget(null)}
      />
    </div>
  )
}