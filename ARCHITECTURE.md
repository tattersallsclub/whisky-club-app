# Architecture and business rules

This document explains how the system is put together and why, and lists
every business rule the app enforces. `README.md` covers setup steps,
this file covers the reasoning behind the design.

## The three layers

**Google Sheet.** The database. Four tabs, `Members`, `RangeMemberships`,
`Redemptions`, `WhiskeySlots`. Never edited by hand during normal
operation, only ever written to by the app.

**Apps Script (`apps-script/Code.gs`).** The API. The only thing allowed
to read or write the Sheet. Every business rule that must never be
skipped lives here, not in the frontend, because the frontend's checks
can be bypassed by a stale page or a direct API call, the backend's
cannot.

**React app (`src/`).** The interface. Talks to Apps Script over HTTP,
never to the Sheet directly. Also keeps a local cache (see below) so a
dropped wifi connection does not lose someone's work.

## Core entities

**Member.** A person. Has a name, a code, and an active flag. The code
**is** the member's id, they are the same value. This was a deliberate
choice, staff already look someone up by code at the bar, keeping a
second internal id around just invites two records for one person. See
"Renaming a member" below for what that implies.

**Range.** A fixed block of ten whiskey slot numbers, `1-10`, `11-20`,
and so on up to `91-100`. Ranges are generated in code
(`domain/clubRules.js`, `listAllRanges`), never stored, because storing
them would let them drift out of sync with the fixed size the club sells
in.

**RangeMembership.** One member's purchase of one range. Has its own
activation date, payment method, and lock flag. A member can hold several
memberships over time, one per range they have ever bought into.

**Redemption.** One of the ten whiskeys inside a membership, with a
consumed flag. Created once, all ten at once, when the membership is
created. Never added to or removed from afterward.

**WhiskeySlot.** A number from 1 to 100 and its current product name. The
number is permanent, the name is not, see "Swapping a whiskey" below.

## Business rules

**A whiskey once owed is owed forever.** If a member's free whiskey for a
given slot has not been redeemed, it stays valid indefinitely, it does
not expire, and it does not matter how old the membership is. This was
confirmed explicitly early in this project, against the instinct that old
unclaimed items should eventually be written off. The one exception is a
membership that has redeemed all ten, see below.

**Ticking is a single tap, unticking asks first.** Marking a whiskey
redeemed is the routine action happening constantly during a shift, so
it stays instant. Undoing that mark is different, it reverses something
that already physically happened at the bar, so an accidental untick
could make the system think a free pour is still owed when it already
happened. Only the untick direction shows a confirmation.

**Completion is computed live, never stored as a flag.** A membership is
"done" the moment all ten of its redemption rows are marked consumed,
checked fresh on every render rather than read from a database column.
There used to be a manual "Lock member" action and a stored `locked`
flag, both were removed once it became clear the club never actually
uses it in practice, members who should no longer participate are
removed at the member level (see below), not frozen range by range. A
completed membership cannot be ticked or unticked, there is nothing left
to change.

**Completed and Expired are independent badges, not a single status.**
A membership shows a "Completed" badge once all ten are redeemed. It
shows an "Expired" badge once more than a year has passed since its
activation date. These can be true at the same time, or neither. A
member who finished all ten whiskeys and is not yet expired can still buy
more whiskeys from that range at member pricing, they are only blocked
from further free pours. A member who is expired but not yet Completed
still has their unclaimed whiskeys waiting exactly as described above,
the running clock only affects paid pricing eligibility going forward,
decided at the bar, not tracked in this app.

**Renewing resets the clock, never the redemptions.** The "Renew
subscription" button, shown right in the card header so it is visible
even while collapsed, only appears when a membership is both Completed
and Expired. It only becomes relevant once the free allocation is used
up, since unclaimed whiskeys are honoured regardless of expiration
anyway, so there is nothing to renew for until a member has actually
exhausted what they were owed. Renewing sets the activation date to today
and records the new payment method (including "None", for a member added
back after being removed by mistake, with no charge), sending a
notification email exactly like a new enrollment does. It never touches
what has already been redeemed or not.

**Renaming a member changes their id everywhere.** Because the code is
the id, editing a member's code is really a rename of that id, not a
plain field edit. The backend (`updateMemberIdentity`) rewrites the
member's own row and every one of their `RangeMemberships` rows in the
same call, so no membership is ever left pointing at an id nobody has
anymore. It refuses the change if another member already owns the new
code.

**Swapping a whiskey never touches history.** Editing a slot's name on
the Whiskeys screen only changes what a future, still unclaimed
redemption of that number will show. Anyone who already redeemed that
slot keeps their record exactly as it was, under whatever name the slot
had at the time.

**Adding a member reuses an existing code.** If the code entered on the
"Add member" form matches someone already in the system, that person's
existing record is used and a new membership is added to their account,
rather than creating a duplicate member under a second id.

**A member's status flag (active/inactive as a person, not a
membership) is separate from all of the above.** "Removing" a member from
the Members screen only flips this flag, it never deletes their history,
so reactivating them later brings their full record straight back,
including their open balance.

## Known quirk: ranges look like dates to Google Sheets

Values like `1-10` or `11-20` are close enough to a month and day that
Google Sheets silently reinterprets them as an actual date the instant
they are typed or written, turning `21-30` into a timestamp. The
`rangeId` column is explicitly locked to plain text format in
`setupSheets`, and every write path re-asserts that format before writing
the value, closing the gap between the column format being set and a
fresh row landing in it. This is also the reason the range column must
never be edited by hand directly in the Sheet.

## Offline resilience

`LocalCacheRepository` wraps the real backend and keeps a copy of the
last successfully loaded state in the browser's local storage. If a write
fails because of the network, it is queued locally instead of shown as an
error, since a bartender mid pour has no way to manually retry later.
Queued writes are retried automatically the next time the app loads data,
which happens on open and on every manual refresh, so no separate "sync
now" step is needed. This is a convenience for short connectivity gaps,
not a replacement for the Sheet, the Sheet is always the source of truth
once a write actually lands.