import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { buildRedemptionsForRange } from '../domain/clubRules'

const DataContext = createContext(null)

const EMPTY_STATE = { members: [], whiskeySlots: [], rangeMemberships: [], purchaseRequests: [] }

/**
 * State lives here instead of inside individual screens because the same
 * membership can be visible from more than one screen at once, for
 * example a range's table and a member's own detail page. A single shared
 * tree keeps both in sync without either screen refetching.
 */
export function DataProvider({ repository, children }) {
  const [state, setState] = useState(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [servedFromCache, setServedFromCache] = useState(false)

  /**
   * The cached copy renders immediately, before any network call, so the
   * app never shows a blank loading screen just because it has already
   * seen this data once before. The real fetch still happens right after,
   * quietly, in the background, and replaces the cached view the moment
   * it lands. Only a genuinely first ever load, with nothing cached yet,
   * has to actually wait, which is the same wait it always had.
   *
   * servedFromCache is only ever set true when the fresh fetch actually
   * failed, never just because the cached copy was shown first while
   * waiting. Setting it during that normal, brief, optimistic window was
   * what made a completely successful sync flash a "showing saved data"
   * warning that was never true. A definite result is returned, rather
   * than only updating state, so a caller like the Synchronize button
   * can react to what actually happened without reading stale state.
   */
  const reload = useCallback(async () => {
    setError(null)
    const cached = repository.getCachedState()
    if (cached) {
      setState(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    try {
      const freshState = await repository.loadState()
      const gotFreshData = !freshState._servedFromCache
      setState(freshState)
      setServedFromCache(!gotFreshData)
      return { success: gotFreshData }
    } catch (err) {
      setServedFromCache(true)
      if (!cached) {
        setError(err.message)
      }
      return { success: false, message: err.message }
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    reload()
  }, [reload])

  /**
   * The checkbox updates in memory immediately, before the network call
   * resolves, because someone standing at the bar needs to see the tick
   * happen instantly. Waiting for a round trip first would make the app
   * feel broken on the exact slow wifi it needs to tolerate.
   */
  const toggleRedemption = useCallback(async (membershipId, slotNumber, consumed) => {
    setState((prev) => ({
      ...prev,
      rangeMemberships: prev.rangeMemberships.map((m) =>
        m.id !== membershipId
          ? m
          : {
              ...m,
              redemptions: m.redemptions.map((r) =>
                r.slotNumber === slotNumber ? { ...r, consumed } : r
              ),
            }
      ),
    }))
    await repository.saveRedemption({ membershipId, slotNumber, consumed })
  }, [repository])

  /**
   * The activation date moves forward, everything already redeemed stays
   * exactly as it was, since renewal is only ever about buying more from
   * this range going forward, never about re-issuing free pours.
   */
  const renewMembership = useCallback(async (membershipId, paymentMethod) => {
    const renewalDate = new Date().toISOString().slice(0, 10)
    setState((prev) => ({
      ...prev,
      rangeMemberships: prev.rangeMemberships.map((m) =>
        m.id === membershipId ? { ...m, activationDate: renewalDate, paymentMethod } : m
      ),
    }))
    await repository.renewMembership({ membershipId, paymentMethod })
  }, [repository])

  /**
   * Removing a member only ever flips the active flag. The club needs
   * their redemption history to stay visible in case they rejoin, so
   * nothing about a member is ever hard deleted from this screen.
   */
  const setMemberActive = useCallback(async (memberId, active) => {
    setState((prev) => ({
      ...prev,
      members: prev.members.map((m) => (m.id === memberId ? { ...m, active } : m)),
    }))
    const member = state.members.find((m) => m.id === memberId)
    if (member) {
      await repository.saveMember({ ...member, active })
    }
  }, [repository, state.members])

  const renameWhiskeySlot = useCallback(async (slotNumber, name) => {
    setState((prev) => ({
      ...prev,
      whiskeySlots: prev.whiskeySlots.map((s) => (s.number === slotNumber ? { ...s, name } : s)),
    }))
    await repository.saveWhiskeySlot({ number: slotNumber, name })
  }, [repository])

  /**
   * The member's code is their id, so editing the code is really a rename
   * of that id everywhere it appears, not a plain field update. Every
   * membership referencing the old id is rewritten in the same pass so
   * the member's history never ends up split across two ids after a
   * simple typo correction. A collision is checked locally first so the
   * person editing sees the problem immediately, without waiting on a
   * round trip only to have the backend reject it.
   */
  const updateMemberIdentity = useCallback(async (currentId, newName, newCode) => {
    const collidesWithSomeoneElse = state.members.some((m) => m.id === newCode && m.id !== currentId)
    if (collidesWithSomeoneElse) {
      throw new Error(`Code ${newCode} already belongs to another member.`)
    }

    setState((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.id === currentId ? { ...m, id: newCode, name: newName, code: newCode } : m
      ),
      rangeMemberships: prev.rangeMemberships.map((rm) =>
        rm.memberId === currentId ? { ...rm, memberId: newCode } : rm
      ),
    }))

    return repository.updateMemberIdentity({ currentId, newName, newCode })
  }, [repository, state.members])

  /**
   * Enrollment covers two things at once, finding or creating the member
   * and creating the membership with its ten redemption rows, in a
   * single call so a partial record can never exist if a step in the
   * middle were ever separated out.
   */
  const enrollMemberInRange = useCallback(async ({ name, code, rangeId, paymentMethod }) => {
    const activationDate = new Date().toISOString().slice(0, 10)
    const result = await repository.enrollMemberInRange({
      name,
      code,
      rangeId,
      paymentMethod,
      activationDate,
    })

    if (result.queued) {
      /**
       * The write is safely queued on this device for the next successful
       * sync, but reloading right now would only show the last state the
       * backend actually confirmed, making the enrollment the staff member
       * just entered seem to vanish. Adding it to local state directly
       * keeps what they see on screen honest about what they just did,
       * while the queued write still catches up with the Sheet later.
       * The member's own code is used as the id here too, matching what
       * the backend will use once the write actually lands.
       */
      const memberId = code
      const membershipId = `pending_${Date.now()}`
      setState((prev) => {
        const memberAlreadyPresent = prev.members.some((m) => m.id === memberId)
        return {
          ...prev,
          members: memberAlreadyPresent
            ? prev.members
            : [...prev.members, { id: memberId, name, code, active: true }],
          rangeMemberships: [
            ...prev.rangeMemberships,
            {
              id: membershipId,
              memberId,
              rangeId,
              activationDate,
              paymentMethod,
              locked: false,
              redemptions: buildRedemptionsForRange(rangeId),
            },
          ],
        }
      })
    } else {
      await reload()
    }

    return result
  }, [repository, reload])

  /**
   * Releasing is what actually performs an enrollment or a renewal that
   * a request only ever queued, so afterward the safest thing is a full
   * reload rather than trying to optimistically guess the exact shape of
   * what changed. The request itself is removed from view immediately
   * though, so staff see it disappear from the pending list the moment
   * they act on it, not only after the reload finishes.
   */
  const releasePurchaseRequest = useCallback(async (requestId) => {
    setState((prev) => ({
      ...prev,
      purchaseRequests: prev.purchaseRequests.filter((r) => r.id !== requestId),
    }))
    await repository.releasePurchaseRequest({ requestId })
    await reload()
  }, [repository, reload])

  const dismissPurchaseRequest = useCallback(async (requestId) => {
    setState((prev) => ({
      ...prev,
      purchaseRequests: prev.purchaseRequests.filter((r) => r.id !== requestId),
    }))
    await repository.dismissPurchaseRequest({ requestId })
  }, [repository])

  /**
   * Permanent, no optimistic guess at what changes, a full reload after
   * this one is the honest choice, since removing a member also removes
   * every membership and redemption they held, too much to try to patch
   * into local state correctly by hand.
   */
  const hardDeleteMember = useCallback(async (memberId) => {
    await repository.hardDeleteMember({ memberId })
    await reload()
  }, [repository, reload])

  /**
   * Same reasoning as hardDeleteMember, permanent and structural enough
   * that a full reload afterward is simpler and safer than trying to
   * patch the membership and its ten redemptions out of local state by
   * hand.
   */
  const deleteMembershipRange = useCallback(async (membershipId) => {
    await repository.deleteMembershipRange({ membershipId })
    await reload()
  }, [repository, reload])

  const value = useMemo(
    () => ({
      state,
      loading,
      error,
      servedFromCache,
      reload,
      toggleRedemption,
      renewMembership,
      setMemberActive,
      renameWhiskeySlot,
      enrollMemberInRange,
      updateMemberIdentity,
      releasePurchaseRequest,
      dismissPurchaseRequest,
      hardDeleteMember,
      deleteMembershipRange,
    }),
    [state, loading, error, servedFromCache, reload, toggleRedemption, renewMembership, setMemberActive, renameWhiskeySlot, enrollMemberInRange, updateMemberIdentity, releasePurchaseRequest, dismissPurchaseRequest, hardDeleteMember, deleteMembershipRange]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useClubData() {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useClubData must be called inside a DataProvider')
  }
  return context
}