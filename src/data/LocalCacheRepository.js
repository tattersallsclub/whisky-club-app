import { DataRepository } from './DataRepository'

const STATE_CACHE_KEY = 'whiskyClub.cachedState'
const PENDING_WRITES_KEY = 'whiskyClub.pendingWrites'

/**
 * This wraps another repository instead of being a repository on its own,
 * because local storage should never be the source of truth on a shared
 * iPad. It exists purely to survive the seconds between a wifi drop and a
 * reconnect, not to replace the Sheet as the place data actually lives.
 */
export class LocalCacheRepository extends DataRepository {
  constructor(innerRepository) {
    super()
    this.inner = innerRepository
  }

  /**
   * Queued writes are flushed here, at the start of every load, rather
   * than left for something else to trigger, because loadState already
   * runs at every moment connectivity is worth rechecking, on app open
   * and on every manual refresh. A queue that is never retried would
   * defeat the entire reason this class exists, so the retry has to be
   * automatic rather than dependent on a caller remembering to ask for it.
   */
  async loadState() {
    await this._attemptFlush()
    try {
      const freshState = await this.inner.loadState()
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(freshState))
      return freshState
    } catch (error) {
      const cached = localStorage.getItem(STATE_CACHE_KEY)
      if (cached) {
        return { ...JSON.parse(cached), _servedFromCache: true }
      }
      throw error
    }
  }

  /**
   * A synchronous read of whatever is already sitting in local storage,
   * used to paint the screen immediately on open while the real network
   * request happens in the background. This never touches the network
   * itself, that is the whole point, it has to be instant.
   */
  getCachedState() {
    const cached = localStorage.getItem(STATE_CACHE_KEY)
    if (!cached) {
      return null
    }
    return { ...JSON.parse(cached), _servedFromCache: true }
  }

  async _attemptFlush() {
    if (this.getPendingWrites().length === 0) {
      return
    }
    try {
      await this.flushPendingWrites()
    } catch (error) {
      // A flush attempt that fails outright (rather than queuing again)
      // means connectivity is still down. The pending writes stay queued
      // and the next loadState call will simply try again.
    }
  }

  async saveMember(member) {
    return this._saveWithFallback('saveMember', member)
  }

  async updateMemberIdentity(payload) {
    return this._saveWithFallback('updateMemberIdentity', payload)
  }

  async saveWhiskeySlot(slot) {
    return this._saveWithFallback('saveWhiskeySlot', slot)
  }

  async enrollMemberInRange(enrollment) {
    return this._saveWithFallback('enrollMemberInRange', enrollment)
  }

  async saveRedemption(redemption) {
    return this._saveWithFallback('saveRedemption', redemption)
  }

  async renewMembership(payload) {
    return this._saveWithFallback('renewMembership', payload)
  }

  async releasePurchaseRequest(payload) {
    return this._saveWithFallback('releasePurchaseRequest', payload)
  }

  async hardDeleteMember(payload) {
    return this._saveWithFallback('hardDeleteMember', payload)
  }

  async deleteMembershipRange(payload) {
    return this._saveWithFallback('deleteMembershipRange', payload)
  }

  async dismissPurchaseRequest(payload) {
    return this._saveWithFallback('dismissPurchaseRequest', payload)
  }

  /**
   * Only a genuine connectivity failure gets queued for later. A browser
   * fetch() that cannot reach the network at all rejects with a
   * TypeError, that is the one case with no way for the person to fix it
   * themselves right now, so the app carries the retry for them. Anything
   * else, a validation rejection thrown deliberately by the backend, an
   * HTTP error status, is a real answer that already arrived and needs
   * to be shown, not hidden behind a queue it will never actually leave
   * (retrying "this code already belongs to someone else" is never going
   * to start succeeding just because time passed).
   */
  async _saveWithFallback(methodName, payload) {
    try {
      return await this.inner[methodName](payload)
    } catch (error) {
      if (error instanceof TypeError) {
        this._queuePendingWrite(methodName, payload)
        return { queued: true }
      }
      throw error
    }
  }

  _queuePendingWrite(methodName, payload) {
    const pending = this.getPendingWrites()
    pending.push({ methodName, payload, queuedAt: new Date().toISOString() })
    localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(pending))
  }

  getPendingWrites() {
    const raw = localStorage.getItem(PENDING_WRITES_KEY)
    return raw ? JSON.parse(raw) : []
  }

  /**
   * Called once connectivity is confirmed again, so writes made while
   * offline reach the Sheet in the order they happened instead of being
   * silently lost the next time the app reloads.
   */
  async flushPendingWrites() {
    const pending = this.getPendingWrites()
    const stillFailing = []
    for (const write of pending) {
      try {
        await this.inner[write.methodName](write.payload)
      } catch (error) {
        stillFailing.push(write)
      }
    }
    localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(stillFailing))
    return { flushed: pending.length - stillFailing.length, remaining: stillFailing.length }
  }
}