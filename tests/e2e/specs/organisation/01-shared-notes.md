# Share notes inside an organisation and keep private data private

Role: user
Where: "/org" on device A (user A) and "/org" on device B (user B, another browser)

## Test data
- Organisation key: generate
- Organisation name: generate
- Note by A: generate
- Note by B: generate
- Bio of A: generate

## Scenario: Two members of one organisation see each other's notes and nothing private

### Steps
1. On device B, sign up as user B and wait for "/me"
2. On device A, sign up as user A, open "/org", enter the key and the name and click "Create"
3. On device A, enter the email of user B and click "Invite"
4. On device A, enter the note by A and click "Add note"
5. On device A, open "/me", enter the bio of A and click "Save"
6. On device B, open "/org"
7. On device B, enter the note by B and click "Add note"

### Expected result
- After step 2 device A shows the organisation name in the heading and the role "Administrator"
- After step 3 device A shows the notification "Invited" and user B in the members list
- After step 6 device B shows the organisation name, the role "Member" and the note by A, without an invitation page or a reload
- Within 5 seconds of step 7 device A shows the note by B, without a reload; the delay is reported as "note-sync-latency-ms"
- Device B shows no members list and no invite form
- Device B shows nothing of user A's profile: its "/me" shows user B's own name and an empty bio
