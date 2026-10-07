import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTemporaryId } from '../domain/clubRules'

/**
 * Matches by name or code as the person types, showing up to eight
 * results, closes on an outside tap same as the range picker. The
 * dropdown renders through a portal into document.body, same reasoning
 * as MultiRangeSelect, so it can never end up clipped or hidden behind
 * something else depending on which screen this ends up used on.
 */
export function MemberAutocomplete({ members, query, onQueryChange, onSelectMember }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function updatePosition() {
      if (!inputRef.current) return
      const rect = inputRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  useEffect(() => {
    function handleOutsideTap(event) {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target) &&
        !event.target.closest('.member-autocomplete-dropdown')
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideTap)
    document.addEventListener('touchstart', handleOutsideTap)
    return () => {
      document.removeEventListener('mousedown', handleOutsideTap)
      document.removeEventListener('touchstart', handleOutsideTap)
    }
  }, [])

  const normalisedQuery = query.trim().toLowerCase()
  const matches =
    normalisedQuery.length < 2
      ? []
      : members
          .filter(
            (m) =>
              m.name.toLowerCase().includes(normalisedQuery) ||
              (!isTemporaryId(m.id) && m.id.toLowerCase().includes(normalisedQuery))
          )
          .slice(0, 8)

  return (
    <div className="member-autocomplete">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Full name"
      />
      {open && matches.length > 0 && position &&
        createPortal(
          <div
            className="member-autocomplete-dropdown"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            {matches.map((m) => (
              <button
                type="button"
                key={m.id}
                className="member-autocomplete-row"
                onClick={() => {
                  onSelectMember(m)
                  setOpen(false)
                }}
              >
                <span>{m.name}</span>
                <span className="member-autocomplete-code">
                  {!isTemporaryId(m.id) ? m.id : 'no code'}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}