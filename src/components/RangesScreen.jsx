import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { listAllRanges, countMembersInRange } from '../domain/clubRules'
import { MembershipCard } from './MembershipCard'

/**
 * A tiny inline person shape instead of an emoji or an icon font, so the
 * count stays legible and consistent at this small size without pulling
 * in a dependency for one glyph.
 */
function AvatarIcon() {
  return (
    <svg className="avatar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="7" r="3.4" fill="currentColor" />
      <path d="M3 17c0-3.6 3.1-6 7-6s7 2.4 7 6" fill="currentColor" />
    </svg>
  )
}

export function RangesScreen({ initialRangeId, onOpenAddMember, onOpenMember }) {
  const { state, toggleRedemption, renewMembership, deleteMembershipRange } = useClubData()
  const ranges = listAllRanges()
  const [activeRangeId, setActiveRangeId] = useState(initialRangeId || ranges[0].id)
  const [query, setQuery] = useState('')

  const whiskeySlotsByNumber = useMemo(
    () => new Map(state.whiskeySlots.map((s) => [s.number, s])),
    [state.whiskeySlots]
  )

  const membersById = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members])

  const membershipsForActiveRange = useMemo(() => {
    return state.rangeMemberships
      .filter((m) => m.rangeId === activeRangeId)
      .map((m) => ({ ...m, memberName: membersById.get(m.memberId)?.name || 'Unknown member' }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName))
  }, [state.rangeMemberships, activeRangeId, membersById])

  const visibleMemberships = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase()
    if (!normalisedQuery) return membershipsForActiveRange
    return membershipsForActiveRange.filter(
      (m) =>
        m.memberName.toLowerCase().includes(normalisedQuery) ||
        m.memberId.toLowerCase().includes(normalisedQuery)
    )
  }, [membershipsForActiveRange, query])

  return (
    <div className="ranges-screen">
      <div className="range-tabs">
        {ranges.map((r) => {
          const memberCount = countMembersInRange(r.id, state.rangeMemberships)
          return (
            <button
              key={r.id}
              className={`range-tab ${activeRangeId === r.id ? 'range-tab-active' : ''}`}
              onClick={() => setActiveRangeId(r.id)}
            >
              {r.id}
              {memberCount > 0 && (
                <span className="range-tab-count">
                  <AvatarIcon />
                  {memberCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="range-detail-header">
        <h2>Range {activeRangeId}</h2>
        <button className="btn btn-primary" onClick={() => onOpenAddMember(activeRangeId)}>
          Add member to this range
        </button>
      </div>

      <input
        type="search"
        className="search-input"
        placeholder="Search this range by name or code"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {visibleMemberships.length === 0 && (
        <p className="all-clear">
          {membershipsForActiveRange.length === 0 ? 'No members enrolled in this range yet.' : 'No match in this range.'}
        </p>
      )}

      {visibleMemberships.map((membership) => (
        <MembershipCard
          key={membership.id}
          membership={membership}
          whiskeySlotsByNumber={whiskeySlotsByNumber}
          onToggle={(membershipId, slotNumber, consumed) => toggleRedemption(membershipId, slotNumber, consumed)}
          onRenew={renewMembership}
          onDelete={deleteMembershipRange}
          onOpenMember={onOpenMember}
          showMemberName={true}
        />
      ))}
    </div>
  )
}