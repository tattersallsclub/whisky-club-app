import * as XLSX from 'xlsx'
import { useClubData } from '../context/DataContext'
import { isMembershipComplete, isMembershipExpired, formatDateDMY, listAllRanges } from '../domain/clubRules'

/**
 * The export used to be one row per whiskey, which is easy for another
 * program to re-read but unreadable for a person, the exact opposite of
 * what a human backup needs. This mirrors the shape of the club's old
 * spreadsheet instead, one row per member, whiskeys running across as
 * columns, so anyone can open it and scan it the way they always have.
 *
 * The old file had one tab per year, that no longer maps onto anything
 * real, a range is not tied to a calendar year, so this uses one tab per
 * range instead, the actual unit the club sells in now.
 */
export function BackupButton() {
  const { state } = useClubData()

  function describeStatus(membership) {
    const labels = []
    if (isMembershipComplete(membership)) labels.push('Completed')
    if (isMembershipExpired(membership)) labels.push('Expired')
    return labels.length > 0 ? labels.join(', ') : 'Active'
  }

  function handleExport() {
    const whiskeySlotsByNumber = new Map(state.whiskeySlots.map((s) => [s.number, s]))
    const membersById = new Map(state.members.map((m) => [m.id, m]))
    const workbook = XLSX.utils.book_new()

    for (const range of listAllRanges()) {
      const membershipsInRange = state.rangeMemberships
        .filter((m) => m.rangeId === range.id)
        .map((m) => ({ ...m, memberName: membersById.get(m.memberId)?.name || 'Unknown member' }))
        .sort((a, b) => a.memberName.localeCompare(b.memberName))

      if (membershipsInRange.length === 0) {
        continue
      }

      const slotNumbers = []
      for (let n = range.startSlot; n <= range.endSlot; n++) slotNumbers.push(n)
      const slotColumnKeys = slotNumbers.map(
        (n) => `${n}: ${whiskeySlotsByNumber.get(n)?.name || `whisky-${n}`}`
      )

      const rows = membershipsInRange.map((membership) => {
        const member = membersById.get(membership.memberId)
        const redemptionBySlot = new Map(membership.redemptions.map((r) => [r.slotNumber, r.consumed]))
        const row = {
          Member: membership.memberName,
          Code: member?.code || '',
          Joined: formatDateDMY(membership.activationDate),
          Payment: membership.paymentMethod || '',
          Status: describeStatus(membership),
        }
        slotNumbers.forEach((n, i) => {
          row[slotColumnKeys[i]] = redemptionBySlot.get(n) ? 'X' : ''
        })
        return row
      })

      const worksheet = XLSX.utils.json_to_sheet(rows)
      // Sheet names cannot exceed 31 characters or contain a colon, a
      // plain range id like "71-80" always fits well inside that limit.
      XLSX.utils.book_append_sheet(workbook, worksheet, range.id)
    }

    const timestamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `whisky_club_backup_${timestamp}.xlsx`)
  }

  return (
    <button className="btn btn-secondary" onClick={handleExport}>
      Export backup to Excel
    </button>
  )
}