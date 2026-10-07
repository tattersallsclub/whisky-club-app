import { useEffect, useState } from 'react'
import {
  listAllRanges,
  PAYMENT_METHODS,
  isMembershipComplete,
  isMembershipExpired,
  formatDateDMY,
} from '../domain/clubRules'
import { APPS_SCRIPT_WEB_APP_URL, WHISKEY_LIST_PDF_URL } from '../config'
import { MultiRangeSelect } from './MultiRangeSelect'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'

// "None" exists so staff can re-add someone removed by mistake without a
// charge, that only ever makes sense as a choice staff make deliberately
// inside the PIN gated app. Offering it here, to anyone who scans the QR
// code, would let a stranger request a free range.
const PORTAL_PAYMENT_METHODS = PAYMENT_METHODS.filter((p) => p.value !== 'none')

async function postJson(action, payload) {
  const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload }),
  })
  const result = await response.json()
  if (result.error) throw new Error(result.error)
  return result
}

/**
 * Reached through a QR code at the bar, deliberately with no PIN in
 * front of it, since it only ever shows one person their own data once
 * they type their own code in, the same trust model as a hotel key card
 * rather than a login. Nothing here writes to Members or
 * RangeMemberships directly, requesting a range, renewing, or joining
 * all only ever create a pending request, staff still review and
 * release it from inside the app, since payment is never actually
 * verified from a page anyone can open.
 */
export function MemberPortalScreen() {
  const [code, setCode] = useState('')
  const [member, setMember] = useState(null)
  const [error, setError] = useState(null)
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [rangePrice, setRangePrice] = useState(null)

  useEffect(() => {
    fetch(`${APPS_SCRIPT_WEB_APP_URL}?action=getSettings`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.error && result.rangePrice) {
          setRangePrice(result.rangePrice)
        }
      })
      .catch(() => {
        // The price is a nice to have on this screen, not something
        // worth showing an error banner over if it fails to load.
      })
  }, [])

  async function fetchMember(codeToFetch) {
    const response = await fetch(
      `${APPS_SCRIPT_WEB_APP_URL}?action=getMemberPublicView&code=${encodeURIComponent(codeToFetch)}`
    )
    const result = await response.json()
    if (result.error) throw new Error(result.error)
    return result
  }

  const [runLookup, lookingUp] = useAsyncAction(async () => {
    setError(null)
    setMember(null)
    try {
      const result = await fetchMember(code.trim())
      setMember(result)
    } catch (err) {
      setError(err.message)
    }
  })

  /**
   * This screen is the kind of thing someone opens once and leaves
   * sitting on their phone for weeks, not something they reopen through
   * the QR code every visit. Refetching whenever the tab becomes visible
   * again (unlocking the phone, switching back to it) means a staff
   * member releasing a request shows up here without the member having
   * to do anything, silently, no loading state, so an old page never
   * quietly keeps showing stale ticks and a stale Completed badge.
   */
  useEffect(() => {
    if (!member) return
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchMember(code.trim()).then(setMember).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [member, code])

  const [runManualRefresh, refreshing] = useAsyncAction(async () => {
    try {
      const result = await fetchMember(code.trim())
      setMember(result)
    } catch {
      // A manual refresh failing quietly leaves the last known good view
      // on screen, which is more useful here than clearing it and
      // showing an error over a page someone might be about to order at.
    }
  })

  return (
    <div className="portal-screen">
      <h1>My Whisky Club</h1>

      {!member && (
        <form onSubmit={(e) => { e.preventDefault(); runLookup() }} className="portal-lookup-form">
          <input
            className="search-input"
            placeholder="Enter your member code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-large" disabled={lookingUp}>
            {lookingUp ? <Spinner /> : 'View my whiskeys'}
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}

      {member && (
        <MemberPublicView
          member={member}
          code={code.trim()}
          rangePrice={rangePrice}
          onBack={() => setMember(null)}
          onRefresh={runManualRefresh}
          refreshing={refreshing}
        />
      )}

      {!member && !showJoinForm && (
        <button className="btn btn-secondary portal-join-link" onClick={() => setShowJoinForm(true)}>
          Not a member? Join us
        </button>
      )}

      {!member && showJoinForm && (
        <RequestForm mode="join" rangePrice={rangePrice} onDone={() => setShowJoinForm(false)} />
      )}

      <a className="portal-pdf-link" href={WHISKEY_LIST_PDF_URL} target="_blank" rel="noreferrer">
        View the full whiskey list (PDF)
      </a>
    </div>
  )
}

function MemberPublicView({ member, code, rangePrice, onBack, onRefresh, refreshing }) {
  const [activeRequest, setActiveRequest] = useState(null) // { mode, rangeId } | null

  const ownedRangeIds = member.ranges.map((r) => r.rangeId)

  return (
    <div className="portal-member-view">
      <div className="portal-member-header">
        <h2>{member.name}</h2>
        <div className="portal-member-header-actions">
          <button className="btn btn-secondary btn-small" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Spinner /> : 'Refresh'}
          </button>
          <button className="btn btn-secondary btn-small" onClick={onBack}>Not you?</button>
        </div>
      </div>

      {member.ranges.length === 0 && <p className="all-clear">No ranges on file yet.</p>}

      {member.ranges.map((range) => {
        const complete = isMembershipComplete({ redemptions: range.redemptions })
        const expired = isMembershipExpired({ activationDate: range.activationDate })
        return (
          <div key={range.rangeId} className="portal-range-card">
            <div className="portal-range-header">
              <div>
                <span className="range-label">Range {range.rangeId}</span>
                <span className="activation-date">Joined {formatDateDMY(range.activationDate)}</span>
              </div>
              <div className="membership-badges">
                {complete && <span className="badge badge-complete">Completed</span>}
                {expired && <span className="badge badge-expired">Expired</span>}
              </div>
            </div>
            <div className="slot-grid">
              {range.redemptions.map((r) => (
                <div key={r.slotNumber} className={`slot-checkbox portal-slot ${r.consumed ? 'slot-checked' : ''}`}>
                  <span className="slot-number">{r.slotNumber}</span>
                  <span className="slot-name">{r.whiskeyName}</span>
                  <span className="portal-slot-status">{r.consumed ? 'Redeemed' : 'Available'}</span>
                </div>
              ))}
            </div>
            {complete && (
              <button
                className="btn btn-primary btn-small"
                onClick={() => setActiveRequest({ mode: 'renewal', rangeId: range.rangeId })}
              >
                Renew subscription
              </button>
            )}
          </div>
        )
      })}

      {!activeRequest && (
        <button className="btn btn-primary btn-large" onClick={() => setActiveRequest({ mode: 'newRange' })}>
          Request a new range
        </button>
      )}

      {activeRequest && (
        <RequestForm
          mode={activeRequest.mode}
          code={code}
          name={member.name}
          fixedRangeId={activeRequest.rangeId}
          ownedRangeIds={ownedRangeIds}
          rangePrice={rangePrice}
          onDone={() => setActiveRequest(null)}
        />
      )}
    </div>
  )
}

/**
 * One form covers all three request types, "join" (no code on file yet,
 * a real one is still required, everyone in the club already has a
 * membership number), "newRange" (existing member picking one or more
 * ranges at once), and "renewal" (a specific already complete range,
 * rangeId is fixed, not chosen, so no multi select applies there). The
 * range picker excludes whatever the member already holds, so nobody can
 * accidentally request a duplicate of a range they are already in.
 */
function RequestForm({ mode, code, name: existingName, fixedRangeId, ownedRangeIds = [], rangePrice, onDone }) {
  const selectableRanges = listAllRanges().filter((r) => !ownedRangeIds.includes(r.id))
  const [memberCode, setMemberCode] = useState(code || '')
  const [name, setName] = useState(existingName || '')
  const [selectedRangeIds, setSelectedRangeIds] = useState(fixedRangeId ? [fixedRangeId] : [])
  const [paymentMethod, setPaymentMethod] = useState(PORTAL_PAYMENT_METHODS[0].value)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const [runSubmit, submitting] = useAsyncAction(async () => {
    if (!memberCode.trim()) {
      setError('Enter your member code.')
      return
    }
    if (!name.trim()) {
      setError('Enter your name.')
      return
    }
    if (selectedRangeIds.length === 0) {
      setError('Select at least one range.')
      return
    }
    setError(null)
    try {
      // One request per range, sequential, same reasoning as the staff
      // side Add Subscription screen, submitPurchaseRequest only ever
      // takes a single range.
      for (const rangeId of selectedRangeIds) {
        await postJson('submitPurchaseRequest', {
          type: mode,
          code: memberCode.trim(),
          name: name.trim(),
          rangeId,
          paymentMethod,
        })
      }
      setDone(true)
    } catch (err) {
      setError(err.message)
    }
  })

  if (done) {
    return (
      <p className="all-clear">
        Request sent.{' '}
        {paymentMethod === 'cash_credit_card'
          ? 'Please find a bar staff member to close the payment.'
          : "Nothing else needed from you, staff will confirm and release it."}
      </p>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); runSubmit() }} className="add-member-form-vertical portal-request-form">
      <h3>
        {mode === 'join' && 'Join the whisky club'}
        {mode === 'newRange' && 'Request a new range'}
        {mode === 'renewal' && `Renew range ${fixedRangeId}`}
      </h3>

      <label>
        Member code
        <input
          value={memberCode}
          onChange={(e) => setMemberCode(e.target.value)}
          disabled={Boolean(code)}
          placeholder="Your club membership number"
        />
      </label>

      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(existingName)} />
      </label>

      {mode !== 'renewal' && (
        <label>
          Ranges (select one or more)
          <MultiRangeSelect ranges={selectableRanges} selected={selectedRangeIds} onChange={setSelectedRangeIds} />
        </label>
      )}

      {rangePrice && (
        <p className="portal-price-line">
          Total: ${rangePrice * (mode === 'renewal' ? 1 : Math.max(selectedRangeIds.length, 1))}
          {' '}for {mode === 'renewal' ? 1 : Math.max(selectedRangeIds.length, 1)} range
          {(mode === 'renewal' ? 1 : selectedRangeIds.length) === 1 ? '' : 's'} (${rangePrice} each)
        </p>
      )}

      <label>
        Payment method
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          {PORTAL_PAYMENT_METHODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      {paymentMethod === 'cash_credit_card' && (
        <p className="portal-disclaimer">
          You will need to find a bar staff member to close the payment before this range is released.
        </p>
      )}
      {paymentMethod === 'member_account' && (
        <p className="portal-disclaimer">
          Nothing else needed from you, staff will add this to your house account.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={submitting}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <Spinner /> : 'Send request'}
        </button>
      </div>
    </form>
  )
}