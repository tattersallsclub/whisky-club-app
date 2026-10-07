import { useMemo, useState } from 'react'
import { useClubData } from '../context/DataContext'
import { findRangeForSlot, isTemporaryId } from '../domain/clubRules'

/**
 * This screen exists to replace the paginated printed list the club
 * described as the hardest part of their old process. Three entry points
 * cover the three things staff need to do in a hurry, find a member, add
 * one, or find a whiskey, without hunting through pages first.
 */
export function HomeScreen({ onOpenMember, onOpenAddMember, onOpenRange }) {
  const { state } = useClubData()
  const [memberQuery, setMemberQuery] = useState('')
  const [whiskeyQuery, setWhiskeyQuery] = useState('')

  const memberResults = useMemo(() => {
    const query = memberQuery.trim().toLowerCase()
    if (!query) return []
    return state.members.filter(
      (m) => m.name.toLowerCase().includes(query) || (!isTemporaryId(m.id) && m.id.toLowerCase().includes(query))
    )
  }, [state.members, memberQuery])

  const whiskeySlotsByNumber = useMemo(
    () => new Map(state.whiskeySlots.map((s) => [s.number, s])),
    [state.whiskeySlots]
  )

  const whiskeyResults = useMemo(() => {
    const query = whiskeyQuery.trim().toLowerCase()
    if (!query) return []
    return state.whiskeySlots.filter((s) => {
      const displayName = s.name || `whisky-${s.number}`
      return String(s.number).includes(query) || displayName.toLowerCase().includes(query)
    })
  }, [state.whiskeySlots, whiskeyQuery])

  return (
    <div className="home-screen">
      <section className="home-section">
        <h2>Find a member</h2>
        <input
          type="search"
          className="search-input"
          placeholder="Search by name or code"
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
        />
        {memberResults.length > 0 && (
          <ul className="home-results">
            {memberResults.map((m) => (
              <li key={m.id}>
                <button className="home-result-btn" onClick={() => onOpenMember(m.id)}>
                  {m.name} {!isTemporaryId(m.id) ? `(${m.id})` : ''} {!m.active && <span className="inactive-tag">inactive</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {memberQuery && memberResults.length === 0 && <p className="no-results">No member found</p>}
      </section>

      <section className="home-section">
        <h2>Find a whiskey</h2>
        <input
          type="search"
          className="search-input"
          placeholder="Search by number or name"
          value={whiskeyQuery}
          onChange={(e) => setWhiskeyQuery(e.target.value)}
        />
        {whiskeyResults.length > 0 && (
          <ul className="home-results">
            {whiskeyResults.map((s) => {
              const range = findRangeForSlot(s.number)
              return (
                <li key={s.number}>
                  <button className="home-result-btn" onClick={() => onOpenRange(range.id)}>
                    {s.number}. {s.name || `whisky-${s.number}`} <span className="range-tag">range {range.id}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {whiskeyQuery && whiskeyResults.length === 0 && <p className="no-results">No whiskey found</p>}
      </section>

      <section className="home-section home-section-last">
        <button className="btn btn-primary btn-large" onClick={onOpenAddMember}>
          Add subscription
        </button>
      </section>
    </div>
  )
}