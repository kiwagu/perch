---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
  Note by B: generate
  Bio of A: generate
---
# Share notes inside an organisation and keep private data private

Where: [/org] on device A (user A) and [/org] on device B (user B, another browser)

## Scenario: Two members of one organisation see each other's notes and nothing private

### Steps
1. On device B, sign up as user B and wait for [/me]
2. On device A, sign up as user A, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
5. On device A, open [/me], enter the bio of A into [user.profile.bio-textarea], click [user.profile.save-button] and open [/org] again
6. On device B, open [/org]
7. On device B, enter the note by B into [organisation.notes.new-textarea] and click [organisation.notes.add-button]

### Expected result
- After step 2 device A shows the organisation name in [organisation.page.heading] and [organisation.page.role-badge] with [value:admin]
- After step 3 device A shows [app-shell.notice-message] carrying [code:invited] and user B in [organisation.members.list]
- After step 6 device B shows the organisation name in [organisation.page.heading], [organisation.page.role-badge] with [value:member] and the note by A in [organisation.notes.list], without an invitation page or a reload
- Within 5 seconds of step 7 device A shows the note by B in [organisation.notes.list], without a reload; the delay is reported as "note-sync-latency-ms"
- Device B shows no [organisation.members.list] and no [organisation.invite.form]
- Device B shows nothing of user A's profile: its [/me] shows user B's own name in [user.profile.heading] and an empty [user.profile.bio-textarea]
