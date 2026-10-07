/**
 * The UI never talks to Google Sheets or local storage directly, it talks
 * to whatever implements this contract. That is what lets the storage
 * backend change later without touching a single screen.
 */
export class DataRepository {
  /**
   * The whole app boots from one snapshot rather than many small requests,
   * because the primary users are bar staff on a shift, not developers.
   * One loading state and one error state is easier to reason about than
   * juggling several independent fetches.
   */
  async loadState() {
    throw new Error('loadState must be implemented by the concrete repository')
  }

  /**
   * Returns whatever was last successfully loaded, synchronously, with no
   * network call involved. This exists so the UI has something real to
   * render the instant the app opens instead of a blank loading screen
   * every single time, even when the data is a few seconds stale. A
   * backend with no caching of its own simply has nothing to offer here,
   * which is why the default is null rather than an error, this is a
   * capability a repository may or may not have, not one every
   * implementation is required to provide.
   */
  getCachedState() {
    return null
  }

  /**
   * Members are archived, never deleted, since the club needs to keep a
   * departed member's history in case they rejoin later.
   */
  async saveMember(member) {
    throw new Error('saveMember must be implemented by the concrete repository')
  }

  /**
   * Kept separate from saveMember because it changes the member's id, not
   * just their name or code field. A plain field update and an id change
   * carry very different risk, one is reversible with another save, the
   * other rewrites every membership that points at that id.
   */
  async updateMemberIdentity(payload) {
    throw new Error('updateMemberIdentity must be implemented by the concrete repository')
  }

  async saveWhiskeySlot(slot) {
    throw new Error('saveWhiskeySlot must be implemented by the concrete repository')
  }

  /**
   * Enrolling is its own operation, separate from saving a plain member
   * record, because it creates both a membership and its ten redemption
   * rows together in one call, never a partial record if a step in the
   * middle were ever separated out.
   */
  async enrollMemberInRange(enrollment) {
    throw new Error('enrollMemberInRange must be implemented by the concrete repository')
  }

  async saveRedemption(redemption) {
    throw new Error('saveRedemption must be implemented by the concrete repository')
  }

  async renewMembership(payload) {
    throw new Error('renewMembership must be implemented by the concrete repository')
  }

  /**
   * submitPurchaseRequest is deliberately not part of this contract. It
   * is a public, unauthenticated action the portal calls directly, never
   * through an authenticated repository, so declaring it here would
   * suggest the staff app can call it too, which it should not.
   */

  /**
   * Performs whatever a pending request asked for (an enrollment or a
   * renewal) and marks it handled. Kept separate from submitting, since
   * only staff, inside the PIN gated app, is ever allowed to call this
   * one, the public portal can only ever create a request, never release
   * one.
   */
  async releasePurchaseRequest(payload) {
    throw new Error('releasePurchaseRequest must be implemented by the concrete repository')
  }

  /**
   * Permanent, no undo. Only ever reachable for a member already
   * inactive, both here and re-checked on the backend, since a screen
   * side check alone would not stop a stale page or a direct call from
   * bypassing it.
   */
  async hardDeleteMember(payload) {
    throw new Error('hardDeleteMember must be implemented by the concrete repository')
  }

  /**
   * Permanent, only ever valid for a fully completed range, checked
   * again on the backend regardless of what the screen already verified.
   */
  async deleteMembershipRange(payload) {
    throw new Error('deleteMembershipRange must be implemented by the concrete repository')
  }

  async dismissPurchaseRequest(payload) {
    throw new Error('dismissPurchaseRequest must be implemented by the concrete repository')
  }
}