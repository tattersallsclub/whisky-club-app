import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { listAllRanges, PAYMENT_METHODS, isTemporaryId, isValidMemberCode } from '../domain/clubRules'
import { MultiRangeSelect } from './MultiRangeSelect'
import { MemberAutocomplete } from './MemberAutocomplete'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'

/**
 * A code that matches an existing member reuses that member's record
 * instead of creating a second one, because the same person buying into a
 * new range next year is the normal case, not an edge case. Creating a
 * fresh member every time would fragment one person's history across
 * several ids. Ranges that member already holds are excluded from the
 * picker entirely, rather than shown and rejected on submit, so there is
 * nothing to accidentally select in the first place.
 *
 * When this screen is opened from a specific range's "Add member to
 * this range" button, that range is not just pre-checked inside a
 * picker, the picker does not appear at all, a locked badge shows it
 * instead. The whole point of that entry point is "this exact range",
 * showing an editable control there would suggest it could still be
 * changed, which was never the intent of tapping that button.
 */
export function AddMemberScreen({ initialRangeId, onDone }) {
  const { state, enrollMemberInRange } = useClubData()
  const { showToast } = useToast()
  const allRanges = listAllRanges()

  const [nameQuery, setNameQuery] = useState('')
  const [code, setCode] = useState('')
  const [selectedRangeIds, setSelectedRangeIds] = useState(initialRangeId ? [initialRangeId] : [])
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].value)
  const [error, setError] = useState(null)

  const matchedMember = useMemo(() => {
    const normalisedCode = code.trim().toLowerCase()
    if (!normalisedCode) return null
    return state.members.find((m) => !isTemporaryId(m.id) && m.id.toLowerCase() === normalisedCode) || null
  }, [state.members, code])

  const ownedRangeIds = useMemo(() => {
    if (!matchedMember) return []
    return state.rangeMemberships.filter((m) => m.memberId === matchedMember.id).map((m) => m.rangeId)
  }, [state.rangeMemberships, matchedMember])

  const selectableRanges = allRanges.filter((r) => !ownedRangeIds.includes(r.id))

  function handleSelectMember(member) {
    setNameQuery(member.name)
    if (!isTemporaryId(member.id)) {
      setCode(member.id)
    }
  }

  const [runSubmit, submitting] = useAsyncAction(async () => {
    const name = matchedMember?.name || nameQuery.trim()
    if (!code.trim()) {
      setError('Enter the member code, it is used as their id.')
      return
    }
    if (!isValidMemberCode(code)) {
      setError('Code must be 1 to 2 letters followed by up to 3 numbers, like A213 or M1.')
      return
    }
    if (!name) {
      setError('Enter the member name.')
      return
    }
    if (selectedRangeIds.length === 0) {
      setError('Select at least one range.')
      return
    }
    setError(null)
    try {
      // One request per range, sequential, since enrollMemberInRange only
      // ever takes a single range, this reuses that exact tested action
      // rather than teaching the backend a second, bulk shaped version of
      // the same thing.
      for (const rangeId of selectedRangeIds) {
        await enrollMemberInRange({ name, code: code.trim(), rangeId, paymentMethod })
      }
      showToast(`${name} added to ${selectedRangeIds.join(', ')}.`, 'success')
      onDone()
    } catch (err) {
      setError(err.message)
      showToast(err.message, 'error')
    }
  })

  return (
    <div className="admin-screen">
      <h2>Add subscription</h2>
      <form onSubmit={(e) => { e.preventDefault(); runSubmit() }} className="add-member-form-vertical">
        <label>
          Name
          <MemberAutocomplete
            members={state.members}
            query={matchedMember ? matchedMember.name : nameQuery}
            onQueryChange={setNameQuery}
            onSelectMember={handleSelectMember}
          />
        </label>

        <label>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Member code" />
        </label>

        {matchedMember && (
          <p className="match-hint">
            Existing member found, {matchedMember.name}. Ranges they already hold are hidden below.
          </p>
        )}

        {initialRangeId ? (
          <label>
            Range
            <div className="locked-range-badge">Range {initialRangeId}</div>
          </label>
        ) : (
          <label>
            Ranges (select one or more)
            <MultiRangeSelect ranges={selectableRanges} selected={selectedRangeIds} onChange={setSelectedRangeIds} />
          </label>
        )}

        <label>
          Payment method
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onDone} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <Spinner /> : 'Add to range'}
          </button>
        </div>
      </form>
    </div>
  )
}