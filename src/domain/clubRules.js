/**
 * Ranges replaced the old calendar season concept because the club's real
 * unit of sale is a block of ten whiskeys, not a year. A member can buy
 * into any block at any time, and the numbering wraps from 100 back to 1,
 * so a range is defined purely by its slot numbers, never by a date.
 */

export const RANGE_SIZE = 10
export const TOTAL_SLOTS = 100
export const MEMBERSHIP_VALIDITY_DAYS = 365
export const TEMPORARY_ID_PREFIX = 'ID-'

/**
 * A temporary id is what a member gets when there is no real code on
 * file for them yet, only ever a leftover from historical data that
 * predates codes being tracked. It uses a shape, a letter sequence and a
 * dash, that no real code in this club's own numbering ever takes (real
 * codes are a single letter directly followed by digits, like A213 or
 * M1), so a temporary id can never be confused with, or collide with, a
 * genuine one, even the ones that happen to look like "M1" themselves.
 */
export function isTemporaryId(id) {
  return typeof id === 'string' && id.startsWith(TEMPORARY_ID_PREFIX)
}

/**
 * A real code is always one or two letters followed by up to three
 * digits, matching the pattern the club already uses on paper (A213,
 * M1, AB12). Enforcing that shape at the point a code is typed in is
 * what keeps every future id predictable and readable, rather than
 * accepting arbitrary text that would make the sheet harder to scan.
 */
export const MEMBER_CODE_PATTERN = /^[A-Za-z]{1,2}\d{1,3}$/

export function isValidMemberCode(code) {
  return MEMBER_CODE_PATTERN.test(code.trim())
}

/**
 * Shared between the add member form and the renewal form, because both
 * are recording the same real world event, a payment (or the deliberate
 * absence of one). Keeping one list instead of two copies is what stops
 * them from quietly drifting apart if a payment method is ever added or
 * renamed.
 */
export const PAYMENT_METHODS = [
  { value: 'member_account', label: 'Member account' },
  { value: 'cash_credit_card', label: 'Cash / credit card' },
  { value: 'none', label: 'None' },
]

/**
 * There are always exactly ten ranges covering the full 1 to 100 catalog.
 * They are generated instead of stored, because storing them would let
 * them drift out of sync with the fixed size the club described.
 */
export function listAllRanges() {
  const ranges = []
  for (let start = 1; start <= TOTAL_SLOTS; start += RANGE_SIZE) {
    const end = start + RANGE_SIZE - 1
    ranges.push({ id: `${start}-${end}`, startSlot: start, endSlot: end })
  }
  return ranges
}

export function getRangeById(rangeId) {
  return listAllRanges().find((r) => r.id === rangeId)
}

/**
 * Finds which range a single slot number belongs to. Used by whiskey
 * search on the home page, since staff search by whiskey, not by range id.
 */
export function findRangeForSlot(slotNumber) {
  return listAllRanges().find((r) => slotNumber >= r.startSlot && slotNumber <= r.endSlot)
}

/**
 * A membership expires exactly one year after its activation date. This
 * only affects whether the member still gets bar side member pricing
 * going forward, which this app does not control. It never blocks ticking
 * a whiskey the member had not yet claimed, because the club confirmed
 * that an unclaimed free whiskey stays honoured regardless of expiration.
 */
export function isMembershipExpired(rangeMembership, today = new Date()) {
  const activationDate = new Date(rangeMembership.activationDate)
  const expiryDate = new Date(activationDate)
  expiryDate.setDate(expiryDate.getDate() + MEMBERSHIP_VALIDITY_DAYS)
  return today > expiryDate
}

/**
 * Completion is always computed from the actual redemption rows, never
 * read from a stored flag, because a flag can fall out of sync with
 * reality (a membership imported already finished, for example) while
 * the ten checkboxes themselves cannot lie about their own state.
 */
export function isMembershipComplete(rangeMembership) {
  return rangeMembership.redemptions.length > 0 && rangeMembership.redemptions.every((r) => r.consumed)
}

/**
 * Google Sheets silently converts a plain date string into an actual date
 * value once it is stored, so the backend can hand back either a clean
 * "2024-02-01" string or a full ISO timestamp with a time zone shift,
 * depending on how that particular cell happened to be typed. Formatting
 * is normalised here, at the one place every screen displays a date,
 * rather than trusting the shape of whatever the Sheet returns.
 */
export function formatDateDMY(dateValue) {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return dateValue
  }
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = String(date.getUTCFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

/**
 * Ten fresh, unclaimed redemption rows for a brand new membership. Kept in
 * one place so the shape of a redemption row is defined exactly once.
 */
export function buildRedemptionsForRange(rangeId) {
  const range = getRangeById(rangeId)
  const redemptions = []
  for (let slotNumber = range.startSlot; slotNumber <= range.endSlot; slotNumber++) {
    redemptions.push({ slotNumber, consumed: false })
  }
  return redemptions
}

/**
 * Used by the dashboard style summary on the ranges list, so staff can see
 * at a glance which range blocks still have outstanding pours without
 * opening every one of them.
 */
export function countOpenSlotsInRange(rangeId, rangeMemberships) {
  return rangeMemberships
    .filter((m) => m.rangeId === rangeId)
    .reduce((total, m) => total + m.redemptions.filter((r) => !r.consumed).length, 0)
}

/**
 * Used on the range tabs to show how many members have ever bought into
 * a range, regardless of whether they have finished, expired, or are
 * still mid way through it. It answers "how many signed up", a different
 * question than "how many still owe something" (countOpenSlotsInRange).
 */
export function countMembersInRange(rangeId, rangeMemberships) {
  return rangeMemberships.filter((m) => m.rangeId === rangeId).length
}