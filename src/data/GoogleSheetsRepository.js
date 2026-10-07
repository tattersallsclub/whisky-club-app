import { DataRepository } from './DataRepository'
import { TOKEN_STORAGE_KEY } from '../components/PinGate'

/**
 * Apps Script web apps only expose GET and POST, so every write goes
 * through POST with an action field instead of separate REST endpoints.
 * That constraint comes from the free hosting choice, not from a design
 * preference, and it is isolated to this one file for exactly that
 * reason.
 *
 * The token is required in the constructor, not optional, because this
 * class is only ever built after PinGate has already produced one. A
 * repository representing an authenticated session should not be
 * constructable without a session to authenticate.
 */
export class GoogleSheetsRepository extends DataRepository {
  constructor(webAppUrl, token) {
    super()
    if (!webAppUrl) {
      throw new Error('GoogleSheetsRepository needs the deployed Apps Script URL')
    }
    if (!token) {
      throw new Error('GoogleSheetsRepository needs a login token')
    }
    this.webAppUrl = webAppUrl
    this.token = token
  }

  async loadState() {
    const response = await fetch(`${this.webAppUrl}?action=getState&token=${encodeURIComponent(this.token)}`)
    if (!response.ok) {
      throw new Error(`Failed to load state: ${response.status}`)
    }
    return this._parseAndCheck(response)
  }

  async saveMember(member) {
    return this._post('upsertMember', member)
  }

  async updateMemberIdentity(payload) {
    return this._post('updateMemberIdentity', payload)
  }

  async saveWhiskeySlot(slot) {
    return this._post('upsertWhiskeySlot', slot)
  }

  async enrollMemberInRange(enrollment) {
    return this._post('enrollMemberInRange', enrollment)
  }

  async saveRedemption(redemption) {
    return this._post('upsertRedemption', redemption)
  }

  async renewMembership(payload) {
    return this._post('renewMembership', payload)
  }

  async releasePurchaseRequest(payload) {
    return this._post('releasePurchaseRequest', payload)
  }

  async hardDeleteMember(payload) {
    return this._post('hardDeleteMember', payload)
  }

  async deleteMembershipRange(payload) {
    return this._post('deleteMembershipRange', payload)
  }

  async dismissPurchaseRequest(payload) {
    return this._post('dismissPurchaseRequest', payload)
  }

  /**
   * submitPurchaseRequest is deliberately not exposed here. This class
   * always carries a staff login token, and the public portal (the only
   * caller of that action) is not staff, it authenticates nobody. Adding
   * it to this class would make it too easy to accidentally call a
   * public, unauthenticated action from inside the authenticated app by
   * mistake, the portal calls it directly instead, with no token at all.
   */

  /**
   * Apps Script web apps respond to POST with a redirect that most
   * browsers cannot follow under strict CORS preflight rules, so the
   * payload is sent as plain text and parsed as JSON server side instead
   * of using the "application/json" content type. This is a known
   * workaround, not an oversight.
   */
  async _post(action, payload) {
    const response = await fetch(this.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, token: this.token }),
    })
    if (!response.ok) {
      throw new Error(`Failed to save (${action}): ${response.status}`)
    }
    return this._parseAndCheck(response)
  }

  /**
   * Apps Script always answers with HTTP 200, even for a rejected
   * business rule or a rejected login, the failure only shows up inside
   * the JSON body as an error field. A session that has expired (or was
   * never valid) is treated specially here rather than as a generic
   * error, since the one useful thing to do about it is send the person
   * back to the PIN screen, not show them a message about whatever
   * action they were actually trying to do.
   */
  async _parseAndCheck(response) {
    const result = await response.json()
    if (result && result.error) {
      if (result.error === 'Not authenticated') {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY)
        window.location.reload()
        // The reload above unmounts everything, this promise never
        // needs to resolve for a real caller, but returning here keeps
        // the function's control flow honest for anyone reading it.
        return new Promise(() => {})
      }
      throw new Error(result.error)
    }
    return result
  }
}