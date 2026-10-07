/**
 * This file exists because the club needs shared storage across more than
 * one iPad without paying for hosting. Apps Script bound to a Google
 * Sheet is the only option that satisfies both constraints at once, since
 * the Sheet itself doubles as the human readable backup the club asked
 * for.
 *
 * Every write funnels through doPost with an action name instead of using
 * separate endpoints, because a single Apps Script deployment only ever
 * exposes one URL for GET and one for POST.
 */

const SHEET_MEMBERS = 'Members'
const SHEET_MEMBERSHIPS = 'RangeMemberships'
const SHEET_REDEMPTIONS = 'Redemptions'
const SHEET_SLOTS = 'WhiskeySlots'
const SHEET_REQUESTS = 'PurchaseRequests'
const SHEET_SETTINGS = 'Settings'
const MEMBER_CODE_PATTERN = /^[A-Za-z]{1,2}[0-9]{1,3}$/

/**
 * Staff and members both sometimes type a code in lowercase or a name
 * in whatever case they happen to be typing in. Every code in the
 * system so far, historical and new, is uppercase, so lookups only work
 * reliably if new entries are forced to match that, rather than trying
 * to make every comparison in the app case insensitive forever.
 */
function normalizeCode(code) {
  return (code || '').trim().toUpperCase()
}

function normalizeName(name) {
  return (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Reads the club's own configurable numbers from a plain Settings sheet
 * instead of a constant in this file, specifically so someone with no
 * coding background can change a price by editing a spreadsheet cell,
 * never a script.
 */
function getRangePrice() {
  const sheet = getSheet(SHEET_SETTINGS)
  const values = sheet.getDataRange().getValues()
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === 'RangePrice') {
      return Number(values[i][1])
    }
  }
  return null
}
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000

/**
 * The real PIN and the admin secret live only in Project Settings >
 * Script Properties, set once by hand through the Apps Script editor's
 * own UI, never typed into a file. That is the entire point, anything
 * written into Code.gs ends up inside the public GitHub repository and
 * inside the JavaScript every visitor's browser downloads, a secret
 * stored there is not a secret. PropertiesService is the one place in
 * this whole system a value can sit that the deployed app itself never
 * exposes.
 */
function requireAuth(token) {
  if (!token) {
    throw new Error('Not authenticated')
  }
  const expiry = PropertiesService.getScriptProperties().getProperty(`TOKEN_${token}`)
  if (!expiry || Number(expiry) < Date.now()) {
    throw new Error('Not authenticated')
  }
}

/**
 * A second, separate secret gates bulkSeed specifically, on top of the
 * normal login, because that one action can overwrite the entire club
 * roster in a single call. A staff member's everyday PIN should not be
 * powerful enough to do that by itself, this secret is only ever meant
 * to be typed once, into the migration scripts run from a terminal, not
 * something that ships inside the deployed app at all.
 */
function requireAdminSecret(providedSecret) {
  const realSecret = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET')
  if (!realSecret || providedSecret !== realSecret) {
    throw new Error('Invalid admin secret.')
  }
}

/**
 * Actions reachable with no login at all. Kept to the smallest possible
 * list on purpose, login itself obviously needs to work before a token
 * exists, and the two public portal actions are meant to be usable by
 * anyone holding the QR code, that is the whole design of that screen,
 * not an oversight.
 */
const PUBLIC_ACTIONS = ['login', 'getMemberPublicView', 'submitPurchaseRequest', 'getSettings']

/**
 * Logging in exchanges the real PIN, checked here, on the server, for a
 * short lived random token, which is the only thing that ever gets
 * stored in the browser afterward. If a browser or a device is ever
 * compromised, only that temporary token leaks, never the PIN itself,
 * and it stops being useful on its own in at most twelve hours.
 */
function login(payload) {
  const properties = PropertiesService.getScriptProperties()
  const realPin = properties.getProperty('APP_PIN')
  if (!realPin) {
    throw new Error('APP_PIN is not set. Add it in Project Settings > Script Properties.')
  }
  if (payload.pin !== realPin) {
    throw new Error('Incorrect PIN.')
  }

  cleanupExpiredTokens(properties)

  const token = Utilities.getUuid()
  const expiresAt = Date.now() + SESSION_DURATION_MS
  properties.setProperty(`TOKEN_${token}`, String(expiresAt))
  return { ok: true, token: token, expiresAt: expiresAt }
}

/**
 * Runs on every login rather than on a timer, since Apps Script has no
 * always on process to schedule this against otherwise. Expired tokens
 * left behind are harmless, requireAuth already rejects them, this only
 * exists so Script Properties (capped at 500 entries total) never fills
 * up with session tokens nobody is using anymore.
 */
function cleanupExpiredTokens(properties) {
  const all = properties.getProperties()
  const now = Date.now()
  Object.keys(all).forEach((key) => {
    if (key.indexOf('TOKEN_') === 0 && Number(all[key]) < now) {
      properties.deleteProperty(key)
    }
  })
}

function doGet(request) {
  const action = request.parameter.action
  try {
    if (!PUBLIC_ACTIONS.includes(action)) {
      requireAuth(request.parameter.token)
    }
    if (action === 'getState') {
      return jsonResponse(getState())
    }
    if (action === 'getMemberPublicView') {
      return jsonResponse(getMemberPublicView(request.parameter.code))
    }
    if (action === 'getSettings') {
      return jsonResponse({ rangePrice: getRangePrice() })
    }
    return jsonResponse({ error: 'Unknown action' })
  } catch (error) {
    return jsonResponse({ error: error.message })
  }
}

function doPost(request) {
  const body = JSON.parse(request.postData.contents)
  const handlers = {
    login: login,
    upsertMember: upsertMember,
    updateMemberIdentity: updateMemberIdentity,
    mergeMember: mergeMember,
    hardDeleteMember: hardDeleteMember,
    bulkRenameMembers: bulkRenameMembers,
    upsertWhiskeySlot: upsertWhiskeySlot,
    enrollMemberInRange: enrollMemberInRange,
    upsertRedemption: upsertRedemption,
    renewMembership: renewMembership,
    bulkSeed: bulkSeed,
    bulkUpdateWhiskeyNames: bulkUpdateWhiskeyNames,
    submitPurchaseRequest: submitPurchaseRequest,
    releasePurchaseRequest: releasePurchaseRequest,
    dismissPurchaseRequest: dismissPurchaseRequest,
    deleteMembershipRange: deleteMembershipRange,
  }
  const handler = handlers[body.action]
  if (!handler) {
    return jsonResponse({ error: 'Unknown action' })
  }
  /**
   * A handler throwing (a real validation rejection, like a missing
   * code, or the target row not existing) used to crash the whole
   * request, and an uncaught crash here does not come back as our clean
   * JSON, Apps Script replaces it with its own error page. The frontend
   * would then fail to parse that as JSON and, unable to tell a real
   * rejection apart from the network being down, silently queue it as
   * if it were offline. Catching it here and always returning valid
   * JSON, error included, is what lets the frontend surface the actual
   * reason instead of hiding it behind a wrong "will retry later".
   */
  try {
    if (!PUBLIC_ACTIONS.includes(body.action)) {
      requireAuth(body.token)
    }
    if (body.action === 'bulkSeed') {
      requireAdminSecret(body.adminSecret)
    }
    const result = handler(body.payload)
    return jsonResponse(result)
  } catch (error) {
    return jsonResponse({ error: error.message })
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)
}

function getSheet(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  const sheet = spreadsheet.getSheetByName(name)
  if (!sheet) {
    throw new Error(`Sheet "${name}" not found. Run setupSheets() once before first use.`)
  }
  return sheet
}

function readRows(sheet) {
  const values = sheet.getDataRange().getValues()
  const headers = values[0]
  return values.slice(1).map((row) => {
    const record = {}
    headers.forEach((header, index) => {
      record[header] = row[index]
    })
    return record
  })
}

function findRowIndexByValue(sheet, columnName, value) {
  const values = sheet.getDataRange().getValues()
  const headers = values[0]
  const columnIndex = headers.indexOf(columnName)
  for (let i = 1; i < values.length; i++) {
    if (values[i][columnIndex] === value) {
      return i + 1 // Sheet rows are one indexed and row 1 is the header.
    }
  }
  return -1
}

/**
 * Reshapes four flat sheets into the nested structure the frontend works
 * with, so the frontend never needs to know redemptions live in a sheet
 * separate from the membership they belong to.
 *
 * There is no separate code field here, the member's id is their code.
 * Someone with no real code yet has an id following the ID-N pattern
 * instead, which the frontend recognises and displays as "no code on
 * file" rather than showing the placeholder itself.
 */
function getState() {
  const members = readRows(getSheet(SHEET_MEMBERS)).map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active === true || row.active === 'TRUE',
  }))

  const redemptionsByMembership = {}
  for (const row of readRows(getSheet(SHEET_REDEMPTIONS))) {
    if (!redemptionsByMembership[row.membershipId]) {
      redemptionsByMembership[row.membershipId] = []
    }
    redemptionsByMembership[row.membershipId].push({
      slotNumber: Number(row.slotNumber),
      consumed: row.consumed === true || row.consumed === 'TRUE',
    })
  }

  const rangeMemberships = readRows(getSheet(SHEET_MEMBERSHIPS)).map((row) => ({
    id: row.id,
    memberId: row.memberId,
    rangeId: row.rangeId,
    activationDate: row.activationDate,
    paymentMethod: row.paymentMethod || null,
    locked: row.locked === true || row.locked === 'TRUE',
    redemptions: redemptionsByMembership[row.id] || [],
  }))

  const whiskeySlots = readRows(getSheet(SHEET_SLOTS)).map((row) => ({
    number: Number(row.number),
    name: row.name || null,
  }))

  // Only pending requests are ever sent to the frontend, released and
  // dismissed ones have already been acted on or removed, there is no
  // screen that needs to see them, so there is no reason to make every
  // load carry that extra weight.
  const purchaseRequests = readRows(getSheet(SHEET_REQUESTS))
    .filter((row) => row.status === 'pending')
    .map((row) => ({
      id: row.id,
      type: row.type,
      code: row.code,
      name: row.name,
      contactInfo: row.contactInfo || null,
      rangeId: row.rangeId,
      paymentMethod: row.paymentMethod,
      requestedAt: row.requestedAt,
    }))

  return { members, whiskeySlots, rangeMemberships, purchaseRequests, rangePrice: getRangePrice() }
}

function upsertMember(member) {
  const sheet = getSheet(SHEET_MEMBERS)
  const rowIndex = findRowIndexByValue(sheet, 'id', member.id)
  const rowValues = [member.id, member.name, Boolean(member.active)]
  if (rowIndex === -1) {
    sheet.appendRow(rowValues)
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues])
  }
  return { ok: true }
}

/**
 * Renaming a member is not a plain field edit, because the member's id is
 * their code, there is no separate code column at all. Changing it means
 * every membership row that points at the old id would silently stop
 * matching that member unless it is rewritten too. Doing both updates
 * inside one function, rather than two separate calls from the frontend,
 * is what stops a membership from ever being left pointing at an id
 * nobody has anymore.
 */
function updateMemberIdentity(payload) {
  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)

  const currentId = payload.currentId
  const isTemporaryPlaceholder = /^ID-\d+$/.test(payload.newCode || '')
  const newCode = isTemporaryPlaceholder ? payload.newCode : normalizeCode(payload.newCode)
  const newName = normalizeName(payload.newName)

  if (!newCode) {
    throw new Error('A member code is required.')
  }
  if (!isTemporaryPlaceholder && !MEMBER_CODE_PATTERN.test(newCode)) {
    throw new Error('Code must be 1 to 2 letters followed by up to 3 numbers, like A213 or M1.')
  }

  const currentRowIndex = findRowIndexByValue(membersSheet, 'id', currentId)
  if (currentRowIndex === -1) {
    throw new Error('Member not found.')
  }

  const idIsChanging = newCode !== currentId
  if (idIsChanging) {
    const collisionRowIndex = findRowIndexByValue(membersSheet, 'id', newCode)
    if (collisionRowIndex !== -1) {
      throw new Error(`Code ${newCode} already belongs to another member.`)
    }
  }

  membersSheet.getRange(currentRowIndex, 1, 1, 2).setValues([[newCode, newName]])

  if (idIsChanging) {
    const values = membershipsSheet.getDataRange().getValues()
    const memberIdCol = values[0].indexOf('memberId')
    for (let i = 1; i < values.length; i++) {
      if (values[i][memberIdCol] === currentId) {
        membershipsSheet.getRange(i + 1, memberIdCol + 1).setValue(newCode)
      }
    }
  }

  return { ok: true, oldId: currentId, newId: newCode }
}

/**
 * A one time cleanup tool for exactly the situation that comes up when
 * the same person exists twice under two different ids, usually because
 * a nickname change split their history into two records before the
 * code was known for both. This moves every membership from the old id
 * onto the surviving id and deletes the old member row entirely, rather
 * than leaving a hollow duplicate behind that could confuse a future
 * search.
 */
function mergeMember(payload) {
  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)

  const fromRowIndex = findRowIndexByValue(membersSheet, 'id', payload.fromId)
  const toRowIndex = findRowIndexByValue(membersSheet, 'id', payload.toId)
  if (fromRowIndex === -1 || toRowIndex === -1) {
    throw new Error('Both members must exist to merge them.')
  }

  membersSheet.getRange(toRowIndex, 1, 1, 3).setValues([[payload.toId, payload.name, payload.active]])

  const values = membershipsSheet.getDataRange().getValues()
  const memberIdCol = values[0].indexOf('memberId')
  for (let i = 1; i < values.length; i++) {
    if (values[i][memberIdCol] === payload.fromId) {
      membershipsSheet.getRange(i + 1, memberIdCol + 1).setValue(payload.toId)
    }
  }

  membersSheet.deleteRow(fromRowIndex)

  return { ok: true }
}

/**
 * A real, permanent delete, unlike setMemberActive/upsertMember which
 * only ever flips the active flag. This only makes sense for a member
 * already inactive, checked here on the backend, not just hidden behind
 * a UI flow, since this is the one action in the whole app with no undo
 * at all. Every redemption and every membership they ever held is
 * removed along with them, on purpose, a member who genuinely left the
 * club for good is exactly the case "an unclaimed whiskey never expires"
 * was never meant to protect against forever.
 */
function hardDeleteMember(payload) {
  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)

  const memberId = payload.memberId
  const memberRowIndex = findRowIndexByValue(membersSheet, 'id', memberId)
  if (memberRowIndex === -1) {
    throw new Error('Member not found.')
  }
  const activeCol = membersSheet.getDataRange().getValues()[0].indexOf('active')
  const isActive = membersSheet.getRange(memberRowIndex, activeCol + 1).getValue()
  if (isActive === true || isActive === 'TRUE') {
    throw new Error('Deactivate this member first, permanent deletion only applies to inactive members.')
  }

  const membershipsValues = membershipsSheet.getDataRange().getValues()
  const memberIdCol = membershipsValues[0].indexOf('memberId')
  const idCol = membershipsValues[0].indexOf('id')
  const membershipIdsToDelete = []
  for (let i = 1; i < membershipsValues.length; i++) {
    if (membershipsValues[i][memberIdCol] === memberId) {
      membershipIdsToDelete.push(membershipsValues[i][idCol])
    }
  }

  const redemptionsValues = redemptionsSheet.getDataRange().getValues()
  const membershipIdColR = redemptionsValues[0].indexOf('membershipId')
  for (let i = redemptionsValues.length - 1; i >= 1; i--) {
    if (membershipIdsToDelete.indexOf(redemptionsValues[i][membershipIdColR]) !== -1) {
      redemptionsSheet.deleteRow(i + 1)
    }
  }

  for (let i = membershipsValues.length - 1; i >= 1; i--) {
    if (membershipsValues[i][memberIdCol] === memberId) {
      membershipsSheet.deleteRow(i + 1)
    }
  }

  membersSheet.deleteRow(memberRowIndex)

  return { ok: true, deletedMemberships: membershipIdsToDelete.length }
}

/**
 * Renames a batch of members in one pass rather than one call per person,
 * since a naming convention change (like standardising to first name
 * before last name) touches every row in the sheet at once, and doing
 * that as dozens of separate network calls would be slow and would leave
 * the sheet half converted if connectivity dropped partway through.
 */
function bulkRenameMembers(renames) {
  const sheet = getSheet(SHEET_MEMBERS)
  const values = sheet.getDataRange().getValues()
  const idCol = values[0].indexOf('id')
  const nameCol = values[0].indexOf('name')
  const renameById = {}
  renames.forEach((r) => { renameById[r.id] = r.name })

  for (let i = 1; i < values.length; i++) {
    const id = values[i][idCol]
    if (Object.prototype.hasOwnProperty.call(renameById, id)) {
      sheet.getRange(i + 1, nameCol + 1).setValue(renameById[id])
    }
  }

  return { ok: true, renamed: renames.length }
}

function upsertWhiskeySlot(slot) {
  const sheet = getSheet(SHEET_SLOTS)
  const rowIndex = findRowIndexByValue(sheet, 'number', slot.number)
  const rowValues = [slot.number, slot.name || '']
  if (rowIndex === -1) {
    sheet.appendRow(rowValues)
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues])
  }
  return { ok: true }
}

/**
 * A redemption is uniquely identified by membership and slot number
 * together, since the same membership always has exactly ten redemption
 * rows created once, at enrollment, and never re-created afterwards.
 */
function upsertRedemption(redemption) {
  const sheet = getSheet(SHEET_REDEMPTIONS)
  const values = sheet.getDataRange().getValues()
  const headers = values[0]
  const membershipCol = headers.indexOf('membershipId')
  const slotCol = headers.indexOf('slotNumber')

  let rowIndex = -1
  for (let i = 1; i < values.length; i++) {
    if (
      values[i][membershipCol] === redemption.membershipId &&
      Number(values[i][slotCol]) === Number(redemption.slotNumber)
    ) {
      rowIndex = i + 1
      break
    }
  }
  if (rowIndex === -1) {
    throw new Error('Redemption row not found, the membership may not have been enrolled correctly.')
  }
  const consumedCol = headers.indexOf('consumed') + 1
  sheet.getRange(rowIndex, consumedCol).setValue(Boolean(redemption.consumed))
  return { ok: true }
}

/**
 * Renewing resets the one year validity clock without touching what has
 * already been redeemed, since renewal is about keeping member pricing
 * on future pours, not about re-issuing whiskeys already given out for
 * free. The notification email mirrors the enrollment one so the same
 * inbox stays the single log of every payment event, new sign ups and
 * renewals alike, rather than splitting that record across two places.
 */
/**
 * Renewing resets the one year validity clock without touching what has
 * already been redeemed, since renewal is about keeping member pricing
 * on future pours, not about re-issuing whiskeys already given out for
 * free.
 */
/**
 * Renewing used to only reset the date, back when a completed range
 * could still be bought from at member pricing without renewing, an
 * unresolved redemption meant something real, resetting it would have
 * erased a whiskey someone was still owed. That stopped being true once
 * completing a range started requiring renewal before buying more from
 * it, once every slot is redeemed, renewing is the only way to get a
 * fresh ten, so it has to actually clear them, otherwise the payment
 * changes nothing at all, which is the exact bug this replaces.
 */
function renewMembership(payload) {
  const sheet = getSheet(SHEET_MEMBERSHIPS)
  const rowIndex = findRowIndexByValue(sheet, 'id', payload.membershipId)
  if (rowIndex === -1) {
    throw new Error('Membership not found')
  }
  const headers = sheet.getDataRange().getValues()[0]
  const activationDateCol = headers.indexOf('activationDate') + 1
  const paymentMethodCol = headers.indexOf('paymentMethod') + 1

  const renewalDate = new Date().toISOString().slice(0, 10)
  sheet.getRange(rowIndex, activationDateCol).setValue(renewalDate)
  sheet.getRange(rowIndex, paymentMethodCol).setValue(payload.paymentMethod)

  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)
  const redemptionsValues = redemptionsSheet.getDataRange().getValues()
  const membershipIdCol = redemptionsValues[0].indexOf('membershipId')
  const consumedCol = redemptionsValues[0].indexOf('consumed') + 1
  for (let i = 1; i < redemptionsValues.length; i++) {
    if (redemptionsValues[i][membershipIdCol] === payload.membershipId) {
      redemptionsSheet.getRange(i + 1, consumedCol).setValue(false)
    }
  }

  return { ok: true, activationDate: renewalDate }
}

/**
 * Finding or creating the member, creating the membership, and writing
 * its ten redemption rows all happen in one call, so a partial record
 * can never exist if a step in the middle were ever separated out.
 *
 * The member's code is used directly as their id, rather than generating
 * a separate internal id, because the code is what staff already use to
 * look someone up at the bar. Keeping two different identifiers for the
 * same person is what causes duplicate records when a code gets typed
 * into one screen but not linked to the id used on another.
 */
function enrollMemberInRange(enrollment) {
  if (!enrollment.code) {
    throw new Error('A member code is required to enroll someone in a range.')
  }
  const normalizedCode = normalizeCode(enrollment.code)
  const normalizedName = normalizeName(enrollment.name)
  if (!MEMBER_CODE_PATTERN.test(normalizedCode)) {
    throw new Error('Code must be 1 to 2 letters followed by up to 3 numbers, like A213 or M1.')
  }

  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)

  const memberId = normalizedCode
  const memberAlreadyExists = findRowIndexByValue(membersSheet, 'id', memberId) !== -1
  if (!memberAlreadyExists) {
    membersSheet.appendRow([memberId, normalizedName, true])
  }

  const membershipId = `rm_${new Date().getTime()}`
  membershipsSheet.appendRow([
    membershipId,
    memberId,
    enrollment.rangeId,
    enrollment.activationDate,
    enrollment.paymentMethod,
    false,
  ])
  // appendRow alone is not enough, a fresh range like "21-30" can still be
  // auto-detected as a date the instant it lands in the sheet. Forcing the
  // format on this exact cell, right after writing it, closes that gap.
  const newRow = membershipsSheet.getLastRow()
  membershipsSheet.getRange(newRow, 3).setNumberFormat('@').setValue(enrollment.rangeId)

  const [startSlot, endSlot] = enrollment.rangeId.split('-').map(Number)
  for (let slotNumber = startSlot; slotNumber <= endSlot; slotNumber++) {
    redemptionsSheet.appendRow([membershipId, slotNumber, false])
  }

  return { ok: true, memberId, membershipId }
}

/**
 * Loads the historical data produced by data-migration/parse_legacy_excel.py
 * in one pass instead of one row per network call, since a few thousand
 * redemption rows sent individually would be slow and would leave the
 * sheet in a half imported state if connectivity dropped partway through.
 */
function bulkSeed(seedData) {
  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)
  const slotsSheet = getSheet(SHEET_SLOTS)

  const memberRows = seedData.members.map((m) => [m.id, m.name, Boolean(m.active)])
  if (memberRows.length > 0) {
    membersSheet.getRange(2, 1, memberRows.length, 3).setValues(memberRows)
  }

  const membershipRows = []
  const redemptionRows = []
  for (const membership of seedData.rangeMemberships) {
    membershipRows.push([
      membership.id,
      membership.memberId,
      membership.rangeId,
      membership.activationDate,
      membership.paymentMethod || '',
      Boolean(membership.locked),
    ])
    for (const redemption of membership.redemptions) {
      redemptionRows.push([membership.id, redemption.slotNumber, Boolean(redemption.consumed)])
    }
  }
  if (membershipRows.length > 0) {
    // Format must be forced to text before the values are written, not
    // after. Once Sheets has already converted "21-30" into a date on
    // write, changing the format afterward only changes how that date is
    // displayed, it does not recover the original text.
    membershipsSheet.getRange(2, 3, membershipRows.length, 1).setNumberFormat('@')
    membershipsSheet.getRange(2, 1, membershipRows.length, 6).setValues(membershipRows)
  }
  if (redemptionRows.length > 0) {
    redemptionsSheet.getRange(2, 1, redemptionRows.length, 3).setValues(redemptionRows)
  }

  const slotRows = seedData.whiskeySlots.map((s) => [s.number, s.name || ''])
  slotsSheet.getRange(2, 1, slotRows.length, 2).setValues(slotRows)

  return { ok: true, members: memberRows.length, memberships: membershipRows.length, redemptions: redemptionRows.length }
}

/**
 * Updates only the whiskey catalog, never members, memberships, or
 * redemptions. Kept as its own action instead of folded into bulkSeed
 * because this needs to run safely at any point after real club data
 * already exists, not just during the one time historical import.
 */
function bulkUpdateWhiskeyNames(slots) {
  const sheet = getSheet(SHEET_SLOTS)
  const rows = slots
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((s) => [s.number, s.name || ''])
  sheet.getRange(2, 1, rows.length, 2).setValues(rows)
  return { ok: true, updated: rows.length }
}

/**
 * Run this once, manually, from the Apps Script editor, before the first
 * deployment. It only creates the sheets and headers, it never touches
 * data, so it is safe to run again later if a sheet is accidentally deleted.
 *
 * The rangeId column is forced to plain text because values like "1-10"
 * or "11-20" look enough like a month and day that Google Sheets silently
 * reinterprets them as an actual date the moment they are typed or
 * written, turning "21-30" into a timestamp instead of a range. Locking
 * the column format to text is what stops that from ever happening again.
 */
function setupSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()

  const definitions = {
    [SHEET_MEMBERS]: ['id', 'name', 'active'],
    [SHEET_MEMBERSHIPS]: ['id', 'memberId', 'rangeId', 'activationDate', 'paymentMethod', 'locked'],
    [SHEET_REDEMPTIONS]: ['membershipId', 'slotNumber', 'consumed'],
    [SHEET_SLOTS]: ['number', 'name'],
    [SHEET_REQUESTS]: ['id', 'type', 'code', 'name', 'contactInfo', 'rangeId', 'paymentMethod', 'status', 'requestedAt'],
    [SHEET_SETTINGS]: ['key', 'value'],
  }

  for (const [name, headers] of Object.entries(definitions)) {
    let sheet = spreadsheet.getSheetByName(name)
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name)
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
  }

  const membershipsSheet = spreadsheet.getSheetByName(SHEET_MEMBERSHIPS)
  membershipsSheet.getRange('C:C').setNumberFormat('@')

  const requestsSheet = spreadsheet.getSheetByName(SHEET_REQUESTS)
  requestsSheet.getRange('F:F').setNumberFormat('@')

  // Seeded once with a sensible starting value, never overwritten on a
  // re-run, so running setupSheets again later never stomps on a price
  // someone has since changed by hand in the sheet.
  const settingsSheet = spreadsheet.getSheetByName(SHEET_SETTINGS)
  const settingsValues = settingsSheet.getDataRange().getValues()
  const hasRangePrice = settingsValues.some((row) => row[0] === 'RangePrice')
  if (!hasRangePrice) {
    settingsSheet.appendRow(['RangePrice', 100])
  }
}

/**
 * Read only, changes nothing. A standing diagnostic, not a one time
 * script, worth keeping around for whenever a manual Sheet edit is
 * suspected of having broken the link between a member and their
 * memberships, rather than assuming either way.
 */
function checkForOrphanedMemberships() {
  const membersSheet = getSheet(SHEET_MEMBERS)
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)

  const memberIds = new Set(
    membersSheet.getDataRange().getValues().slice(1).map((row) => row[0]).filter(Boolean)
  )

  const membershipsValues = membershipsSheet.getDataRange().getValues()
  const memberIdCol = membershipsValues[0].indexOf('memberId')
  const rangeIdCol = membershipsValues[0].indexOf('rangeId')

  const orphaned = []
  for (let i = 1; i < membershipsValues.length; i++) {
    const memberId = membershipsValues[i][memberIdCol]
    if (memberId && !memberIds.has(memberId)) {
      orphaned.push({ row: i + 1, memberId, rangeId: membershipsValues[i][rangeIdCol] })
    }
  }

  Logger.log(`Checked ${membershipsValues.length - 1} membership rows against ${memberIds.size} members.`)
  Logger.log(`Found ${orphaned.length} orphaned membership rows.`)
  orphaned.forEach((o) => Logger.log(JSON.stringify(o)))
}

/**
 * Read only, changes nothing. Every membership always has exactly ten
 * redemption rows, created once at enrollment and never added to again,
 * so any membership with more or fewer than ten is a sign something got
 * written twice (or partially), not a legitimate state.
 */
function checkForDuplicateRedemptions() {
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)
  const values = redemptionsSheet.getDataRange().getValues()
  const membershipIdCol = values[0].indexOf('membershipId')

  const countsByMembershipId = {}
  for (let i = 1; i < values.length; i++) {
    const id = values[i][membershipIdCol]
    countsByMembershipId[id] = (countsByMembershipId[id] || 0) + 1
  }

  const problems = Object.keys(countsByMembershipId).filter((id) => countsByMembershipId[id] !== 10)
  Logger.log(`Checked ${Object.keys(countsByMembershipId).length} memberships' redemption counts.`)
  Logger.log(`Found ${problems.length} with a count other than 10.`)
  problems.forEach((id) => Logger.log(`${id}: ${countsByMembershipId[id]} rows`))
}

/**
 * Read only, changes nothing. One member should never hold two separate
 * membership rows for the exact same range, that would mean they were
 * enrolled into it twice.
 */
function checkForDuplicateMemberships() {
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const values = membershipsSheet.getDataRange().getValues()
  const memberIdCol = values[0].indexOf('memberId')
  const rangeIdCol = values[0].indexOf('rangeId')

  const seen = {}
  const duplicates = []
  for (let i = 1; i < values.length; i++) {
    const key = `${values[i][memberIdCol]}::${values[i][rangeIdCol]}`
    if (seen[key]) {
      duplicates.push({ row: i + 1, memberId: values[i][memberIdCol], rangeId: values[i][rangeIdCol] })
    }
    seen[key] = true
  }

  Logger.log(`Checked ${values.length - 1} membership rows.`)
  Logger.log(`Found ${duplicates.length} duplicate member/range pairs.`)
  duplicates.forEach((d) => Logger.log(JSON.stringify(d)))
}

/**
 * Read only, changes nothing. Prints the full detail (activation date,
 * payment method, and every slot's consumed status) for every membership
 * belonging to the given member and range, specifically so a duplicate
 * can be resolved by looking at which row actually has real tick history
 * versus which one is empty or spurious, rather than guessing which of
 * two rows is safe to remove.
 */
function inspectMembershipsFor(memberId, rangeId) {
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)

  const membershipsValues = membershipsSheet.getDataRange().getValues()
  const headers = membershipsValues[0]
  const memberIdCol = headers.indexOf('memberId')
  const rangeIdCol = headers.indexOf('rangeId')

  const redemptionsValues = redemptionsSheet.getDataRange().getValues()
  const rHeaders = redemptionsValues[0]
  const rMembershipCol = rHeaders.indexOf('membershipId')
  const rSlotCol = rHeaders.indexOf('slotNumber')
  const rConsumedCol = rHeaders.indexOf('consumed')

  for (let i = 1; i < membershipsValues.length; i++) {
    const row = membershipsValues[i]
    if (row[memberIdCol] !== memberId || row[rangeIdCol] !== rangeId) continue

    const record = {}
    headers.forEach((h, idx) => { record[h] = row[idx] })
    Logger.log(`--- Membership row ${i + 1}: ${JSON.stringify(record)} ---`)

    const slots = []
    for (let j = 1; j < redemptionsValues.length; j++) {
      if (redemptionsValues[j][rMembershipCol] === row[0]) {
        slots.push(`${redemptionsValues[j][rSlotCol]}:${redemptionsValues[j][rConsumedCol]}`)
      }
    }
    Logger.log(`  redemptions (${slots.length}): ${slots.join(', ')}`)
  }
}

/**
 * Powers the public, no PIN member portal reached through a QR code at
 * the bar. Returns only what one specific member is allowed to see about
 * themselves, their name, their ranges, and their redemption status,
 * never the full member list or anyone else's data, since nothing sits
 * in front of this endpoint except knowledge of one's own code, the same
 * trust model as a hotel key card rather than a login.
 */
function getMemberPublicView(code) {
  if (!code) {
    throw new Error('A member code is required.')
  }
  const normalizedCode = normalizeCode(code)
  const state = getState()
  const member = state.members.find((m) => m.id === normalizedCode)
  if (!member) {
    throw new Error('No member found with that code.')
  }

  const whiskeyNameBySlot = {}
  state.whiskeySlots.forEach((s) => { whiskeyNameBySlot[s.number] = s.name })

  const ranges = state.rangeMemberships
    .filter((m) => m.memberId === normalizedCode)
    .map((m) => ({
      rangeId: m.rangeId,
      activationDate: m.activationDate,
      redemptions: m.redemptions
        .slice()
        .sort((a, b) => a.slotNumber - b.slotNumber)
        .map((r) => ({
          slotNumber: r.slotNumber,
          whiskeyName: whiskeyNameBySlot[r.slotNumber] || `whisky-${r.slotNumber}`,
          consumed: r.consumed,
        })),
    }))

  return { name: member.name, active: member.active, ranges: ranges }
}

/**
 * Powers "request a new range", "join us", and "renew subscription" from
 * the public portal, all three land here as a pending row instead of
 * writing anything to Members or RangeMemberships directly. Payment is
 * never actually verified from a page anyone with the QR code can open,
 * so nothing real happens until staff reviews it in the app and taps
 * Release, which is what actually calls enrollMemberInRange or
 * renewMembership.
 */
function submitPurchaseRequest(payload) {
  if (!payload.code) {
    throw new Error('A member code is required.')
  }
  const normalizedCode = normalizeCode(payload.code)
  const normalizedName = normalizeName(payload.name)
  if (!MEMBER_CODE_PATTERN.test(normalizedCode)) {
    throw new Error('Code must be 1 to 2 letters followed by up to 3 numbers, like A213 or M1.')
  }
  if (!normalizedName) {
    throw new Error('A name is required.')
  }
  if (!payload.rangeId) {
    throw new Error('A range is required.')
  }

  const sheet = getSheet(SHEET_REQUESTS)
  const id = `req_${new Date().getTime()}`
  const newRow = sheet.getLastRow() + 1
  // Same reasoning as everywhere else a range id is written, "1-10" can
  // be silently reinterpreted as a date the instant it lands in a cell
  // unless the column is already locked to plain text first.
  sheet.getRange(newRow, 6).setNumberFormat('@')
  sheet.getRange(newRow, 1, 1, 9).setValues([[
    id,
    payload.type,
    normalizedCode,
    normalizedName,
    payload.contactInfo || '',
    payload.rangeId,
    payload.paymentMethod,
    'pending',
    new Date().toISOString(),
  ]])

  return { ok: true, requestId: id }
}

/**
 * Actually performs what a request asked for, the enrollment or the
 * renewal, using exactly the same functions the staff app itself calls
 * for a direct add or renew, so a released request behaves identically
 * to staff doing it by hand. The request row is kept afterward with its
 * status flipped, rather than deleted, so there is still a record of
 * every request that was ever acted on, not just the ones still pending.
 */
function releasePurchaseRequest(payload) {
  const sheet = getSheet(SHEET_REQUESTS)
  const rowIndex = findRowIndexByValue(sheet, 'id', payload.requestId)
  if (rowIndex === -1) {
    throw new Error('Request not found.')
  }
  const headers = sheet.getDataRange().getValues()[0]
  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0]
  const request = {}
  headers.forEach((header, index) => { request[header] = row[index] })

  if (request.type === 'renewal') {
    const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
    const membershipValues = membershipsSheet.getDataRange().getValues()
    const mHeaders = membershipValues[0]
    const memberIdCol = mHeaders.indexOf('memberId')
    const rangeIdCol = mHeaders.indexOf('rangeId')
    const idCol = mHeaders.indexOf('id')
    let membershipId = null
    for (let i = 1; i < membershipValues.length; i++) {
      if (membershipValues[i][memberIdCol] === request.code && membershipValues[i][rangeIdCol] === request.rangeId) {
        membershipId = membershipValues[i][idCol]
        break
      }
    }
    if (!membershipId) {
      throw new Error('Matching membership not found for this renewal request.')
    }
    renewMembership({ membershipId: membershipId, paymentMethod: request.paymentMethod })
  } else {
    enrollMemberInRange({
      code: request.code,
      name: request.name,
      rangeId: request.rangeId,
      paymentMethod: request.paymentMethod,
      activationDate: new Date().toISOString().slice(0, 10),
    })
  }

  const statusCol = headers.indexOf('status') + 1
  sheet.getRange(rowIndex, statusCol).setValue('released')
  return { ok: true }
}

/**
 * Dismissing deletes the row outright, unlike releasing. A dismissed
 * request was never acted on, so there is nothing about it worth
 * keeping, and leaving rejected requests lying around would just make
 * the pending list harder to trust at a glance.
 */
function dismissPurchaseRequest(payload) {
  const sheet = getSheet(SHEET_REQUESTS)
  const rowIndex = findRowIndexByValue(sheet, 'id', payload.requestId)
  if (rowIndex === -1) {
    throw new Error('Request not found.')
  }
  sheet.deleteRow(rowIndex)
  return { ok: true }
}

/**
 * Permanent, no undo, unlike archiving (which was designed to move a
 * range's data out of the way while keeping the payment record intact).
 * This is the opposite, the payment record itself is gone afterward.
 * Only allowed when every slot is already consumed, checked here on the
 * backend, not just hidden behind a UI condition, since a stale screen
 * or a direct call could otherwise delete a range someone still has
 * whiskeys owed on.
 */
function deleteMembershipRange(payload) {
  const membershipsSheet = getSheet(SHEET_MEMBERSHIPS)
  const redemptionsSheet = getSheet(SHEET_REDEMPTIONS)

  const rowIndex = findRowIndexByValue(membershipsSheet, 'id', payload.membershipId)
  if (rowIndex === -1) {
    throw new Error('Membership not found.')
  }

  const redemptionsValues = redemptionsSheet.getDataRange().getValues()
  const membershipIdCol = redemptionsValues[0].indexOf('membershipId')
  const consumedCol = redemptionsValues[0].indexOf('consumed')

  const rowsToDelete = []
  let allConsumed = true
  for (let i = 1; i < redemptionsValues.length; i++) {
    if (redemptionsValues[i][membershipIdCol] === payload.membershipId) {
      rowsToDelete.push(i + 1)
      const consumed = redemptionsValues[i][consumedCol]
      if (!(consumed === true || consumed === 'TRUE')) {
        allConsumed = false
      }
    }
  }

  if (rowsToDelete.length === 0 || !allConsumed) {
    throw new Error('Only a fully completed range can be deleted.')
  }

  rowsToDelete.sort((a, b) => b - a).forEach((rowNum) => redemptionsSheet.deleteRow(rowNum))
  membershipsSheet.deleteRow(rowIndex)

  return { ok: true }
}