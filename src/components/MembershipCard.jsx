import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Spinner } from './Spinner'
import { useToast } from '../context/ToastContext'
import { isMembershipComplete, isMembershipExpired, formatDateDMY, PAYMENT_METHODS } from '../domain/clubRules'

/**
 * Completed is computed live from the ten redemption rows on every
 * render, never read from a stored flag, so a membership that arrived
 * already finished (imported historical data, a manual Sheet edit,
 * anything) is correctly treated as finished without needing an explicit
 * action to catch up to reality. There used to be a separate manual lock
 * step here, it was removed once it became clear the club never actually
 * uses it, members who are done are removed at the member level, not
 * frozen range by range.
 *
 * Completed and Expired stay two independent badges rather than one
 * merged status, they answer different questions and can both be shown
 * at once. Completed means no more free pours are owed. Expired means
 * the one year member pricing window has lapsed. Renewal itself is
 * triggered by completion alone now, not by expiry, finishing a range
 * always requires renewing before buying more from it, regardless of
 * how much time is left on the clock.
 */
export function MembershipCard({ membership, whiskeySlotsByNumber, onToggle, onRenew, onDelete, onOpenMember, showMemberName }) {
  const { showToast } = useToast()
  const [showCompletionNotice, setShowCompletionNotice] = useState(false)
  const [pendingUncheckSlot, setPendingUncheckSlot] = useState(null)
  const [renewing, setRenewing] = useState(false)
  const [renewSubmitting, setRenewSubmitting] = useState(false)
  const [renewPaymentMethod, setRenewPaymentMethod] = useState(PAYMENT_METHODS[0].value)
  const [pendingToggleSlot, setPendingToggleSlot] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const complete = isMembershipComplete(membership)
  const expired = isMembershipExpired(membership)
  const canRenew = complete
  const [collapsed, setCollapsed] = useState(complete)

  const sortedRedemptions = [...membership.redemptions].sort((a, b) => a.slotNumber - b.slotNumber)
  const consumedCount = sortedRedemptions.filter((r) => r.consumed).length
  const pendingUncheckWhiskeyName = pendingUncheckSlot
    ? whiskeySlotsByNumber.get(pendingUncheckSlot)?.name || `whisky-${pendingUncheckSlot}`
    : null

  /**
   * Ticking a box stays a single tap, since it is the routine action
   * happening constantly during a shift and friction there just slows
   * staff down. Unticking is different, it undoes a pour that already
   * physically happened, so an accidental tap could make the system
   * think a whiskey is still owed when it was already given out. That
   * asymmetry is why only the uncheck direction goes through a prompt.
   */
  function handleToggle(slotNumber, nextConsumed) {
    if (complete) return
    if (!nextConsumed) {
      setPendingUncheckSlot(slotNumber)
      return
    }

    const isLastRemaining = consumedCount + 1 === sortedRedemptions.length
    runToggle(slotNumber, true, isLastRemaining)
  }

  /**
   * No toast anywhere in this file, on purpose, ticking (and unticking,
   * and renewing) happens constantly during a shift and a message for
   * every single one would be noise, not help. Failures are still caught
   * rather than left as an unhandled rejection, they just fail silently,
   * the checkbox simply stays in its previous state, which is enough
   * signal on its own that nothing changed.
   */
  async function runToggle(slotNumber, nextConsumed, isLastRemaining) {
    setPendingToggleSlot(slotNumber)
    try {
      await onToggle(membership.id, slotNumber, nextConsumed)
      if (isLastRemaining) {
        setShowCompletionNotice(true)
      }
    } catch {
      // Deliberately silent, see comment above.
    } finally {
      setPendingToggleSlot(null)
    }
  }

  async function confirmUncheck() {
    const slotNumber = pendingUncheckSlot
    setPendingUncheckSlot(null)
    await runToggle(slotNumber, false, false)
  }

  /**
   * Clicking Renew from the header both expands the card and opens the
   * payment form in one tap, so the header button is a genuine shortcut
   * rather than something that still requires manually expanding first
   * to actually use.
   */
  function startRenewing(event) {
    event.stopPropagation()
    setCollapsed(false)
    setRenewing(true)
  }

  /**
   * Renewal is not a "tick", it is a payment event with its own form,
   * so unlike checkbox ticking it still gets a toast, matching every
   * other modal driven action in the app.
   */
  async function confirmRenewal() {
    setRenewSubmitting(true)
    try {
      await onRenew(membership.id, renewPaymentMethod)
      showToast('Membership renewed.', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setRenewSubmitting(false)
      setRenewing(false)
    }
  }

  /**
   * Only ever offered once complete, same condition as Renew, since
   * deleting a range that still owes whiskeys would throw away a debt
   * the club still has to the member, not just a record. The backend
   * enforces this too, this is a convenience, not the actual safeguard.
   */
  async function confirmDelete() {
    setDeleting(true)
    try {
      await onDelete(membership.id)
      showToast('Range deleted.', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setDeleting(false)
      setPendingDelete(false)
    }
  }

  return (
    <div className={`membership-card ${complete ? 'membership-card-complete' : ''}`}>
      <div
        className="membership-card-header membership-card-toggle"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <div>
          {showMemberName && onOpenMember && (
            <button
              className="membership-member-name membership-member-link"
              onClick={(e) => {
                e.stopPropagation()
                onOpenMember(membership.memberId)
              }}
            >
              {membership.memberName}
            </button>
          )}
          {showMemberName && !onOpenMember && (
            <span className="membership-member-name">{membership.memberName}</span>
          )}
          <span className="range-label">Range {membership.rangeId}</span>
          <span className="activation-date">Joined {formatDateDMY(membership.activationDate)}</span>
          <span className="consumed-count">{consumedCount}/{sortedRedemptions.length}</span>
        </div>
        <div className="membership-badges">
          {complete && <span className="badge badge-complete">Completed</span>}
          {expired && <span className="badge badge-expired">Expired</span>}
          {canRenew && (
            <button className="btn btn-primary btn-small" onClick={startRenewing}>
              Renew subscription
            </button>
          )}
          {complete && onDelete && (
            <button
              className="btn btn-danger btn-small"
              onClick={(e) => {
                e.stopPropagation()
                setPendingDelete(true)
              }}
            >
              Delete range
            </button>
          )}
          <span className="collapse-caret">{collapsed ? '+' : '-'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="slot-grid">
            {sortedRedemptions.map((slot) => (
              <label
                key={slot.slotNumber}
                className={`slot-checkbox ${slot.consumed ? 'slot-checked' : ''} ${pendingToggleSlot === slot.slotNumber ? 'slot-pending' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={slot.consumed}
                  disabled={complete || pendingToggleSlot === slot.slotNumber}
                  onChange={(e) => handleToggle(slot.slotNumber, e.target.checked)}
                />
                <span className="slot-number">{slot.slotNumber}</span>
                <span className="slot-name">{whiskeySlotsByNumber.get(slot.slotNumber)?.name || `whisky-${slot.slotNumber}`}</span>
                {pendingToggleSlot === slot.slotNumber && <Spinner />}
              </label>
            ))}
          </div>

          {renewing && (
            <div className="renew-form">
              <label>
                Payment method
                <select value={renewPaymentMethod} onChange={(e) => setRenewPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button className="btn btn-secondary btn-small" onClick={() => setRenewing(false)} disabled={renewSubmitting}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-small" onClick={confirmRenewal} disabled={renewSubmitting}>
                  {renewSubmitting ? <Spinner /> : 'Confirm renewal'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingUncheckSlot)}
        title="Undo this redemption"
        message={`This marks whisky-${pendingUncheckSlot} (${pendingUncheckWhiskeyName}) as not yet redeemed. Only do this if it was ticked by mistake, not to give this member another free pour of the same whiskey.`}
        confirmLabel="Undo"
        onConfirm={confirmUncheck}
        onCancel={() => setPendingUncheckSlot(null)}
      />

      <ConfirmDialog
        open={showCompletionNotice}
        title="Last free whiskey redeemed"
        message={`This was the last free whiskey for this member in range ${membership.rangeId}. No more free redemptions are owed on this range, and it is now locked. Buying more whiskeys from this range requires renewing their subscription first.`}
        confirmLabel="OK"
        onConfirm={() => setShowCompletionNotice(false)}
        onCancel={() => setShowCompletionNotice(false)}
      />

      <ConfirmDialog
        open={pendingDelete}
        title="Delete range"
        message="The range will be permanently deleted, do you want to continue?"
        confirmLabel={deleting ? <Spinner /> : 'Delete'}
        confirmDisabled={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  )
}