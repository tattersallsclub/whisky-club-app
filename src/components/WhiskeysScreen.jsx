import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog } from './ConfirmDialog'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { listAllRanges } from '../domain/clubRules'

/**
 * Search shows a flat filtered list across all 100 slots, ignoring range
 * grouping entirely, because someone searching already knows what they
 * are looking for and does not want to hunt through which range it lives
 * in first. The grouped, collapsible view is for browsing instead of
 * searching, so the two views intentionally do not try to be the same
 * layout.
 */
export function WhiskeysScreen() {
  const { state, renameWhiskeySlot } = useClubData()
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const [collapsedRanges, setCollapsedRanges] = useState({})
  const [editingSlot, setEditingSlot] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [pendingChange, setPendingChange] = useState(null)

  const [runSave, saving] = useAsyncAction(async (change) => {
    try {
      await renameWhiskeySlot(change.slot.number, change.newName)
      showToast(`Slot ${change.slot.number} updated.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingChange(null)
      setEditingSlot(null)
    }
  })

  const slotsByNumber = new Map(state.whiskeySlots.map((s) => [s.number, s]))
  const ranges = listAllRanges()

  const searchResults = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase()
    if (!normalisedQuery) return null
    return state.whiskeySlots.filter((s) => {
      const displayName = s.name || `whisky-${s.number}`
      return String(s.number).includes(normalisedQuery) || displayName.toLowerCase().includes(normalisedQuery)
    })
  }, [state.whiskeySlots, query])

  function startEditing(slot) {
    setEditingSlot(slot.number)
    setDraftName(slot.name || '')
  }

  function requestSave(slot) {
    setPendingChange({ slot, newName: draftName.trim() })
  }

  function toggleRangeCollapsed(rangeId) {
    setCollapsedRanges((prev) => ({ ...prev, [rangeId]: !prev[rangeId] }))
  }

  function renderSlotRow(number) {
    const slot = slotsByNumber.get(number) || { number, name: null }
    return (
      <li key={number}>
        <span className="slot-number-badge">{number}</span>
        {editingSlot === number ? (
          <>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus />
            <button className="btn btn-primary btn-small" onClick={() => requestSave(slot)}>Save</button>
            <button className="btn btn-secondary btn-small" onClick={() => setEditingSlot(null)}>Cancel</button>
          </>
        ) : (
          <>
            <span className="slot-name">{slot.name || `whisky-${number}`}</span>
            <button className="btn btn-secondary btn-small" onClick={() => startEditing(slot)}>Edit</button>
          </>
        )}
      </li>
    )
  }

  return (
    <div className="admin-screen">
      <h2>Whiskeys</h2>
      <p className="admin-hint">
        Renaming a slot here does not erase who already redeemed that number.
        The new name only applies to whoever has not claimed that slot yet.
        A slot with no name on file shows as whisky-N.
      </p>

      <input
        type="search"
        className="search-input"
        placeholder="Search by number or name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {searchResults ? (
        <ul className="whiskey-admin-list search-results-list">
          {searchResults.length === 0 && <li className="no-results">No whiskey found</li>}
          {searchResults.map((s) => renderSlotRow(s.number))}
        </ul>
      ) : (
        ranges.map((range) => {
          const isCollapsed = Boolean(collapsedRanges[range.id])
          return (
            <div key={range.id} className="whiskey-range-group">
              <button className="whiskey-range-toggle" onClick={() => toggleRangeCollapsed(range.id)}>
                <h3>Range {range.id}</h3>
                <span className="collapse-caret">{isCollapsed ? '+' : '-'}</span>
              </button>
              {!isCollapsed && (
                <ul className="whiskey-admin-list">
                  {Array.from({ length: 10 }, (_, i) => range.startSlot + i).map((number) => renderSlotRow(number))}
                </ul>
              )}
            </div>
          )
        })
      )}

      <ConfirmDialog
        open={Boolean(pendingChange)}
        title="Swap whiskey"
        message={
          pendingChange
            ? `Change slot ${pendingChange.slot.number} from "${pendingChange.slot.name || `whisky-${pendingChange.slot.number}`}" to "${pendingChange.newName || `whisky-${pendingChange.slot.number}`}"?`
            : ''
        }
        confirmLabel={saving ? <Spinner /> : 'Confirm swap'}
        confirmDisabled={saving}
        onConfirm={() => runSave(pendingChange)}
        onCancel={() => setPendingChange(null)}
      />
    </div>
  )
}