import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The dropdown renders through a portal straight into document.body,
 * not as a normal child here, because a normal child is always subject
 * to whatever stacking context its ancestors create (a transform, an
 * overflow, anything). No z-index value fixes that from the inside, the
 * dropdown has to physically live outside the form to guarantee it
 * always draws above everything else, regardless of which screen this
 * component ends up used on.
 */
export function MultiRangeSelect({ ranges, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function updatePosition() {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
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
      if (triggerRef.current && !triggerRef.current.contains(event.target) && !event.target.closest('.multi-range-dropdown')) {
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

  function toggle(rangeId) {
    if (selected.includes(rangeId)) {
      onChange(selected.filter((r) => r !== rangeId))
    } else {
      onChange([...selected, rangeId])
    }
  }

  const summary =
    selected.length === 0
      ? 'Select ranges'
      : selected.length <= 3
        ? selected.join(', ')
        : `${selected.length} ranges selected`

  return (
    <div className="multi-range-select">
      <button type="button" className="multi-range-trigger" ref={triggerRef} onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        <span className="multi-range-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && position &&
        createPortal(
          <div
            className="multi-range-dropdown"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            {ranges.length === 0 && <p className="multi-range-empty">No ranges left to select.</p>}
            {ranges.map((r) => (
              <p key={r.id} className={`multi-range-row ${selected.includes(r.id) ? 'multi-range-row-checked' : ''}`}>
                <input
                  type="checkbox"
                  id={`range-${r.id}`}
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <label htmlFor={`range-${r.id}`}>
                  <span>Range {r.id}</span>
                </label>
              </p>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}