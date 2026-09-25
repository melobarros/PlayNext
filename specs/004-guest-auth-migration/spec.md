# Feature Specification: Guest Accounts & Migration

**Feature Branch**: `004-guest-auth-migration`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "004 — guest/auth migration: accounts (email/password
or Google sign-in), seamless guest-to-account data migration, and
cross-session persistence for registered users."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guest creates an account and keeps everything (Priority: P1)

A guest has used PlayNext without an account: quiz preferences, deck ratings,
watchlist entries, and watching history all live on their device. They open
the Profile area and create an account with email and password, or with
Google. On success, every saved preference, rating, watchlist entry, and
history entry moves into their account automatically — nothing is lost — and
they are signed in without redoing anything.

**Why this priority**: Lossless guest-to-account migration is a headline
promise of the product (constitution, Principle III) and a PRD acceptance
criterion ("Guest Registers Mid-Session"). Without it, converting a guest
silently discards their taste data — the worst possible outcome for trust.

**Independent Test**: As a guest, complete the quiz, rate three titles, and
lock in one Watch Now; then register with email/password. Confirm the
watchlist, history, and quiz preferences are intact while signed in, on this
device and on a second device after signing in there. Delivers value: a
guest converts to an account with zero data loss.

**Acceptance Scenarios**:

1. **Given** a guest with saved preferences, ratings, and history, **When**
   they register with email and password, **Then** the account contains all
   of that data and the visitor is signed in immediately.
2. **Given** a guest with saved data, **When** they register with Google,
   **Then** the same lossless migration happens via Google sign-in.
3. **Given** a registered account, **When** the user signs in on a second
   device, **Then** their preferences, watchlist, and history appear there.
4. **Given** a guest with no saved data, **When** they register, **Then** a
   fresh empty account is created and they are signed in.

---

### User Story 2 - Registered user's data follows them across sessions and devices (Priority: P2)

A registered user signs in on any device and immediately has their
preferences, ratings, watchlist, and history — exactly as they left them.
Changes made while signed in (ratings, re-ratings, removals, quiz retakes,
Watch Now decisions) are saved to the account, so the next session, on any
device, picks up where they left off.

**Why this priority**: This is the PRD's stated reason for accounts
("saved automatically across sessions"). It upgrades the device-local
guarantees of specs 001–003 into a cross-device guarantee.

**Independent Test**: Sign in on device A, rate a title, then open the app
on device B and sign in — the new rating is there. Retake the quiz on
device B and confirm device A shows the new preferences after reload.
Delivers value: the user's taste data is portable.

**Acceptance Scenarios**:

1. **Given** a user signed in on two devices, **When** they rate or re-rate
   a title on one, **Then** the change appears on the other after the app
   is opened or refreshed there.
2. **Given** a user who retakes the quiz, **When** they sign in on another
   device, **Then** the updated preferences apply there.
3. **Given** a user who signs out and back in on the same device, **When**
   they open the watchlist, **Then** their account data is fully restored.

---

### User Story 3 - Guest data merges with an existing account on sign-in (Priority: P3)

A visitor has used the app as a guest on a device — maybe a shared computer
or a new phone — and already has some ratings there. They sign in to their
existing account. The device's guest data merges with the account's data:
every distinct title from both sides is kept; where both sides acted on the
same title, the newer action wins. Nothing else is lost.

**Why this priority**: Sign-in is a second, equally common migration path
(the constitution requires lossless migration "on registration or
sign-in"). Without a defined merge rule, this path either duplicates data
or overwrites one side.

**Independent Test**: On a fresh device, rate title X as Disliked as a
guest (newer timestamp), then sign in to an account that previously rated X
as Loved. Confirm X is now Disliked everywhere, the account's other titles
are untouched, and the guest's other titles were added. Delivers value:
no guest session is ever wasted, and no account history is clobbered.

**Acceptance Scenarios**:

1. **Given** a guest device with ratings and an account that has its own,
   **When** the guest signs in, **Then** titles unique to either side all
   appear in the merged account.
2. **Given** both sides rated the same title differently, **When** the
   guest signs in, **Then** the newer action wins on that title, on every
   device.
3. **Given** guest and account both have quiz preferences, **When** the
   guest signs in, **Then** the more recently saved preferences win.
4. **Given** the merge completes, **When** the visitor looks at the deck's
   exclusions, **Then** Disliked/Not Interested titles from either side
   stay excluded (no excluded title sneaks back in).

---

### User Story 4 - The user manages their account (Priority: P4)

From the Profile area, a signed-in user can sign out and change their
password. Sign-out removes the account's data from the device and returns
the app to guest mode, fully usable without an account and with no account
data left behind. Signing back in restores everything.

**Why this priority**: Account management closes the loop: a session must
be endable (privacy on shared devices) and credentials must be changeable.
It is the smallest story, but without it accounts feel one-way.

**Independent Test**: Sign in, change the password, sign out, confirm the
app is back in guest mode with no account data visible, sign in with the
new password, and confirm all data returns. Delivers value: the visitor
stays in control of the account.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they sign out, **Then** the app
   returns to guest mode, fully usable, with none of the account's data
   remaining on the device.
2. **Given** a signed-in user, **When** they change their password after
   confirming the current one, **Then** the new password works on all
   subsequent sign-ins.
3. **Given** a signed-out visitor, **When** they sign in again, **Then**
   their full account state is restored.

---

### Edge Cases

- What happens when a visitor registers an email that is already
  registered? Registration is rejected with a friendly message that offers
  sign-in instead.
- What happens when Google sign-in uses an email that matches an existing
  account? The visitor is signed into that account — no duplicate account
  is created (see Assumptions).
- What happens when the visitor cancels Google sign-in (or the popup is
  blocked)? They return to their previous state, nothing changed, with a
  friendly message; email/password registration remains available.
- What happens when the network drops during migration? The device's guest
  data stays fully intact; the visitor keeps using the app as a guest, and
  migration retries on their next registration or sign-in attempt.
- What happens when the wrong password is entered? A friendly, generic
  error is shown; after 5 consecutive failures the account is temporarily
  blocked from sign-in with a clear message (see Assumptions).
- What happens when the visitor is offline? Registration and sign-in are
  unavailable with a clear notice; guest mode keeps working and nothing is
  lost.
- What happens when a session expires? The user is asked to sign in again;
  their data is untouched.
- What happens when two devices change the same title differently? The
  newest action wins on that title everywhere — the same rule as the
  migration merge.
- What happens if the visitor closes the app mid-migration? Same as a
  dropped network: guest data is untouched and migration retries later.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST remain fully usable without an account; no
  step of the quiz, deck, watchlist, or history MAY require sign-in. The
  Profile area MUST invite account creation without ever interrupting the
  core loop.
- **FR-002**: The Profile area MUST offer account creation with email and
  password, and sign-in with Google.
- **FR-003**: When a guest with saved data registers, the system MUST
  automatically migrate their preferences, ratings, watchlist, and
  watching history into the new account with nothing lost, and MUST sign
  them in.
- **FR-004**: When a guest with saved data signs in to an existing
  account, the system MUST merge device data with account data: every
  distinct title from both sides MUST be kept; where both sides acted on
  the same title, the newer action MUST win; the same newest-wins rule
  MUST apply to preferences.
- **FR-005**: After registration or sign-in, the merged state MUST be
  identical on this device and on every other device the account signs in
  to.
- **FR-006**: Changes made while signed in (ratings, re-ratings, removals,
  quiz retakes, Watch Now decisions) MUST be saved to the account and MUST
  be available after sign-in anywhere.
- **FR-007**: Migration MUST be lossless and recoverable: if it fails or
  is interrupted, the device's guest data MUST remain intact, the visitor
  MUST be able to continue as a guest, and the system MUST retry the
  migration on the next registration or sign-in attempt.
- **FR-008**: Email addresses MUST be validated at registration;
  registering an already-registered email MUST be rejected with a message
  that offers sign-in instead.
- **FR-009**: Signing in with Google MUST connect the visitor to the
  existing account when the Google email matches one, and MUST create a
  new account otherwise.
- **FR-010**: Passwords MUST be hidden while entered and MUST NOT be
  stored or displayed in readable form anywhere.
- **FR-011**: Wrong-credential attempts MUST show a friendly, generic
  error; after 5 consecutive failures on the same account, sign-in for
  that account MUST be temporarily blocked with a clear message.
- **FR-012**: The visitor MUST be able to cancel Google sign-in at any
  point and return to their previous state with nothing changed.
- **FR-013**: The user MUST be able to sign out from the Profile area;
  sign-out MUST remove the account's data from the device and return the
  app to guest mode with the full guest experience intact.
- **FR-014**: The user MUST be able to change their password after
  confirming their current password; the new password MUST apply to all
  subsequent sign-ins.
- **FR-015**: Signed-in sessions MUST expire automatically; after 30 days
  without activity the user MUST sign in again.
- **FR-016**: While offline, registration and sign-in MUST be unavailable
  with a clear notice; guest mode MUST keep working and no guest data MAY
  be lost by an offline auth attempt.
- **FR-017**: All Profile and auth screens MUST remain fully usable at
  360px viewport width with touch targets of at least 44px, in dark
  high-contrast styling.

### Key Entities *(include if feature involves data)*

- **User Account**: a registered identity — email, credential material
  (stored in a non-readable form), creation time, and region.
- **Account Preference / Account Rating / Account History Entry**: the
  account's persistent copies of the Preference, Rating/Interaction, and
  Watching History Entry entities defined in specs 001 and 003, available
  across sessions and devices.
- **Guest Session Data**: the device-local set of preferences, ratings,
  and history entries a guest accumulates before an account exists — the
  source of every migration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of a guest's saved preferences, ratings, and history
  entries survive migration — the account's state matches the device's
  counts and values exactly after registration, verified on a second
  device.
- **SC-002**: A guest completes registration and sees their migrated data
  within 60 seconds of starting sign-up.
- **SC-003**: 100% of a signed-in user's changes made on one device appear
  on another device after the app is opened or refreshed there.
- **SC-004**: In 100% of interrupted or failed migration attempts, the
  guest's device data remains fully intact and a later retry completes the
  migration.
- **SC-005**: 100% of merge conflicts (the same title rated on both sides)
  resolve with the newer action winning and no other data lost.
- **SC-006**: At least 90% of first-time registration attempts succeed
  without error.
- **SC-007**: After sign-out, zero account data remains visible or
  recoverable on the device.
- **SC-008**: Median time from opening the Profile area to a completed
  sign-in is under 30 seconds.
- **SC-009**: The full account flow (register, migrate, sign out, sign in,
  change password) is completable on a 360px-wide screen with touch input
  only.

## Assumptions

- Scope: accounts, sign-in, guest-to-account migration, sign-out, and
  password change. Forgot-password ("reset password") and account
  deletion are out of scope for this spec, as is the Settings view's
  subscription/language management (a future spec).
- The merge rule is union-plus-newest-wins: titles unique to either side
  are kept; conflicting values on the same title (or the preferences
  record) are resolved by the newer action, which supersedes the older
  one.
- After a successful migration, the account becomes the source of truth:
  the device's guest copy is retired and the visitor stays signed in.
- Sign-out clears the device's copy of account data; the account itself is
  unaffected and reappears on the next sign-in.
- Google sign-in links to an existing account by matching the verified
  Google email, instead of creating a duplicate account.
- Numeric defaults chosen where the PRD is silent: sessions expire after
  30 days of inactivity; sign-in is temporarily blocked after 5
  consecutive failures; accounts activate immediately with no
  email-verification round-trip (keeping sign-up friction low, per
  Principle II).
- The security implementation (credential storage, session handling,
  browser protections) follows the constitution's Engineering Standards;
  this spec describes user-visible behavior only.
- This spec consumes the entities and device-local persistence contracts
  of specs 001–003; the guest experience described there is unchanged by
  this feature.
- Exclusions migrate as ratings: a title rated Disliked or Not Interested
  on the device stays excluded after migration.
