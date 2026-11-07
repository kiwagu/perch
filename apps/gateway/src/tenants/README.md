# Organisations (module `tenants`)

## Role in the architecture

The gateway's organisations: each organisation's own database, the directory's rows of who
belongs to it, the services that create organisations and change their members, and the
routes over them. It also tells the region hub where each region lives
(`region-databases.ts`). It has no domain rules of its own, so no `domain/` or `application/`
folders, and no `index.ts` yet: it predates the index rule and is imported file by file. Its
`organisations/` folder (split out of one file) and its `invitations/` folder are each entered
through their own `index.ts`.

Organisations live in the same namespace, each in a strict database `t_<key>` of its own that
the gateway defines; the directory holds each organisation (`tenant`) and who belongs to it
(`membership`), and the organisation's database holds its `member` rows. Two services of this
module, built by the composition root over the directory, serve them; on shutdown the
organisations' databases close after the region hub and before the directory. `TenantDatabases`
keeps one connection per organisation database in use, shared by every holder and closed once
nobody has held it for five minutes; once closed at shutdown it hands out none. `Organisations` creates an organisation (its directory
rows, its database, its creator as admin member there, then ready; a creation its creator left
unfinished, or whose listeners failed to hear it, is completed when the creator asks again), lists an identity's memberships in ready
organisations by key, lets an admin invite an existing identity by email, change a member's role
and remove a member other than itself, lists the members with their emails to an admin (leaving out the rows of
identities that are gone), answers what it refuses
with a refusal code (`invalid-key`, `key-taken`, `not-admin`, `already-member` and the like),
and tells its listeners an identity's new memberships whenever they change, answering once they
heard them: the composition root has the registry tell the identity's devices. A removal takes
the organisation's region from the removed identity's open connections as soon as the
directory's membership is gone, before the member row is deleted and before the memberships are
read again to be told, so a removal that fails after the directory (500) has revoked the region
all the same; asking again completes it. Until the revoke reaches the removed identity's
connection, a batch its device pushes there may still be accepted: that window between the
directory's commit and the revoke is inherent. The changes of one identity's memberships (its
creations, the invites of it, its role changes, its removals, its departure) run one after the other, each once
the one before it and its notification have settled, so the directory and the organisation's
database end as the last change left them and its devices hear the lists in that order. An
invite, a role change, a removal and a departure also run, inside the identity's turn, in the
turn of each organisation they change, and decide there from the rows as they are then: an
invite, a role change or a removal is refused when its organisation went (`no-such-tenant`) or
its admin is one no more, and a departure counts who else belongs. This holds within one gateway process; gateways in
several processes would need a durable revision of the memberships.
An identity whose account goes leaves its organisations through `AccountDeparture`, judged by
the directory's memberships and their roles: `blocked` is true while it is the only admin of a
ready organisation with other members, and `leave` takes every organisation it is the only member
of whole, of any status, and takes it out of every other one (its member row, then its
membership, so a run again after a failure finds what is left; its notes stay). An organisation
that goes whole has its region retired at the hub first (`RegionHub.retire`), while its key is
still taken, so no document of it stays in memory for an organisation created again under the
key to subscribe to; a retire that fails stops the departure with nothing removed. Then its
database, its memberships and its directory row go in one transaction, then the cached
connection.
`Organisations.leaveAll` runs that departure in the identity's turn and the turns of its
organisations, so an invite of it and a creation by it wait, and so does any change of another
identity there; `leave` reads the rows again in those turns and is refused `last-admin`, changing
nothing, while the identity is the only admin of a ready organisation with others in it. That
check is the one that decides. The caller's steps run in the same turns (`DepartureSteps`):
`before` once the departure is allowed and ahead of every write, its value the departure's answer
and its error (a stop of the caller's own type, or a failure) stopping it with nothing changed,
so what must not happen to an identity that stays (the auth module spends the deletion's link and
ends the account's sessions there) happens only when it leaves; `after` once the identity left
(the auth module removes the account's own rows there), its failure the answer. A refused
departure runs neither. It revokes no region and tells nobody: the caller closes the identity's
connections in `before`, and the other members read the members when they ask.
`OrganisationAdmission.admit(tenant, identity, role)` is the one operation that adds a member
with a role: the directory's membership with that role, then the member row; an identity already in
is refused `already-member` once its member row is written again with the role the directory
holds. The direct invite calls it with `member`.
`Organisations.setRole` changes a member's role for an admin, in the identity's turn and the
organisation's, through the same check of the admin as the other changes (`OrganisationRoleChange`).
It decides from the directory's rows as they are in the turn: an identity that is no member is
refused `no-such-member`, nothing written, and the demotion of an admin while the directory counts
one admin (`membership-admins.surql`) `last-admin`, once that admin's member row is written again
with the role the directory holds (as the admission does for `already-member`: a self-demotion that
failed at the directory, followed by the other admin's, would otherwise leave the only admin shown
as a member); a failure of that write answers instead, and nobody is told. Otherwise it writes the
organisation's member row first (the members list reads the roles there), then the directory's
membership (`membership-set-role.surql`), then has the identity's open connections push into the
organisation's region as the new role allows (the `rerole` option, with the role known and no read,
as a removal revokes the region: a failure of the telling leaves no old privilege alive), then
tells the identity's listeners. The directory is the
authority, so a failure before its write leaves it as it was and the same admin asking again redoes
the change, a self-demotion included; a failure of the telling is completed by asking again, but
for a self-demotion, whose actor is no admin any more. The role an identity already holds is
written and told again. Two admins demoting each other at once leave one admin: the second, no
admin any more in its turn, is refused `not-admin`; a self-demotion and the other admin's departure
at once leave one admin, the second refused `last-admin`.
`Organisations` (`organisations/service.ts`) checks what is asked and orders the changes; each
change is a part of its own beside it: `OrganisationCreation` (`creation.ts`),
`OrganisationAdmission` (`admission.ts`), `OrganisationRoleChange` (`role-change.ts`),
`OrganisationRemoval` (`removal.ts`), `AdminTurn` (`admin-turn.ts`, the organisation's turn held for
a change one of its admins asked, once the admin is found still one), and
`MembershipListeners` (`listeners.ts`), who hears the changes. They read the directory through
`OrganisationLookup` and an organisation's `member` rows through `TenantMembers`;
`MembershipTurns` (`turns.ts`) holds the identities' and the organisations' turns, each a
`KeyedTurns` (`src/keyed-turns.ts`), an identity's always taken first and several
organisations' in the order of their ids, so no two changes wait for each other. The identity
an invite names is found by its email, in any case, through the auth module's one lookup
(`identityByEmail`, `src/auth/identity-by-email.ts`); an email no identity has is refused
`no-such-identity` here. The invite looks the email up again in the identity's turn and is
refused `no-such-identity` when it no longer names that identity, and a creation reads its
creator again in its turn (`OrganisationLookup.existing`) and is refused `no-such-identity` when
it is gone: one that waited for a departure whose `after` removed the identity writes no
membership of an identity that is gone and provisions nothing.

`PendingInvitations` (`invitations/`) keeps the invitations to organisations: one row of the
directory's `invitation` table per organisation and email (the email in lower case), with the
role the invited account takes on accepting, who invited it, the token its link carries and its
expiry, seven days after it was sent on the gateway's clock. The token is signed by the gateway
with a key derived from the auth secret, as the links of an account deletion are, and names the
row's id; it is kept on the row, so a list of an organisation's invitations answers the very link
the mail carried. A newer invitation of the email replaces the older in one transaction, so the
older link names a row that is gone; the same transaction sweeps the organisation's expired rows,
which otherwise stay until the organisation invites again or goes whole (an organisation that
goes whole takes its invitations in the same transaction). `read` tells a link's token apart as
an invitation, as one that expired (also once its row was swept) or as nothing (not signed by the
gateway, replaced, removed, or to an organisation that is not ready); `ofTenant` lists an
organisation's invitations not expired, newest first, whatever account has the email now;
`forEmail` lists those to the ready organisations an identity does not belong to. Nothing of it
logs, and no error names a token or an address.

`InvitationMails` (`invitations/`, an `InvitationMailer`) writes and sends the mail of an
invitation: it starts at once and returns, never awaited, so the request that invited never waits
for the mail server. It speaks the recipient's language: the one the
settings of the account with the invited email name, or the one that account signed up in before
it has settings; an email with no account gets the inviter's, read the same way. A language that
could not be read sends nothing (`mail:LOCALE_UNREADABLE`) and an account gone between the two
reads sends nothing either (`mail:SEND_FAILED`), never a mail in a guessed language. The mail
greets no one by name and names no inviter (the recipient may have no account, and the name people
see lives in the replicated profile, which mails do not read). A mail that did not go out is
logged by its code alone, never with its address, its organisation or its link.

`OrganisationInvitations` (`organisations/invitations.ts`, exposed as `Organisations.invitations`;
the services above are the only way in) is the invitation workflow over that store, the mail and
the organisation's turns. An admin of an organisation invites an email, in any case, with a role
(`invite`): `AdminTurn` finds the organisation and the admin still right, one statement over the
organisation's memberships by email (`membership-of-email.surql`) refuses an email a member has
(`already-member`; the same work whether the email has an account or not), the email's pending
invitation is replaced (its older link then reads as invalid), and the mail is started, never
awaited and never failing the call; the answer carries the link of the very token mailed. An
admin lists the organisation's invitations (`pending`) and revokes one (`revoke`, in the
organisation's turn: an invitation of another organisation, or one already gone, is a success that
deletes nothing). The page a link opens reads the token (`read`): the organisation's name and the
role, and `forYou` when the viewer's directory email is the invitation's, never the email itself;
a token the gateway did not sign or whose row is gone is refused `link-invalid`, one a week old
`link-expired`; `mine` lists the invitations of the account's email to organisations it does not
belong to. The invited account answers by the invitation's id or by its link's token (told apart
by the invitation id schema alone) in `InvitationAnswers` (`organisations/invitation-answers.ts`):
`accept` runs in the account's turn and the organisation's, reads the invitation, the account and
its email again there (`invitation-gone`, `no-such-identity`, `other-account`: the invitation is
bound to its email and the directory's email is the one compared), and an account that belongs
already is refused `already-member`, its member row written again with the directory's role and the
invitation kept. Otherwise `OrganisationAdmission.accept` writes the member row with the
invitation's role, then one directory transaction (`invitation-accept.surql`) writes the
membership and deletes the invitation, then the account's listeners hear it. The member row goes
first: a failure before the transaction leaves the invitation live and asking again completes it,
while a membership written before a member row that then failed would leave a member no list
shows, with the invitation spent. A failure of the telling leaves the membership made, its member
row right and the invitation spent. A spent link never readmits: once an admin removes the member,
the old link answers `invitation-gone`. `decline` runs in the organisation's turn and deletes the
row for the invited account alone.

The organisation routes (`organisation.routes.ts`) are Bearer calls (`src/auth/README.md`).
`GET /organisations` lists the
caller's memberships; `POST /organisations` with `{ key, name }` creates an organisation with
the caller as its admin (201); `GET /organisations/:key/members` lists the members to an admin
(403 `not-admin` to a member); `POST /organisations/:key/members` with `{ email }` lets an admin
invite an identity; and `DELETE /organisations/:key/members/:identity` lets an admin remove a
member (204). A body or an identity that does not follow its schema answers 400 (`bad-request`);
a refusal answers its code, with 400 for `invalid-key`, `invalid-name` and `email-invalid`, 403
for `not-a-member`, `not-admin` and `other-account`, 404 for `no-such-tenant`, `no-such-identity`,
`no-such-member` and `link-invalid`, 409 for `key-taken`, `already-member`, `self` and
`last-admin`, and 410 for `link-expired` and `invitation-gone`, except a creation whose caller's identity went before
its turn (its account deleted after its session was read), which answers 401 `unauthorized` as a
token that holds no session does; an invitation or a creation over its limit answers 429
(`rate-limited`, see `src/limits/README.md`); a failure of the gateway answers 500 (`internal`).

## Surface

- Routes: `GET /organisations`, `POST /organisations`, `GET /organisations/:key/members`,
  `POST /organisations/:key/members`, `DELETE /organisations/:key/members/:identity`
  (`organisation.routes.ts`).
- Services: `Organisations` (`organisations/`, through its `index.ts`; `leaveAll` among its
  commands),
  `AccountDeparture` (`account-departure.ts`: `blocked`, `leave`), `TenantDatabases`
  (`tenant-databases.ts`), `OrganisationLookup` (`organisation-lookup.ts`), `TenantMembers`
  (`tenant-members.ts`), the refusal codes (`organisation-refusal.ts`) and the rows they read
  (`organisation-rows.ts`). `OrganisationInvitations` (`organisations/invitations.ts`),
  `InvitationAnswers` (`organisations/invitation-answers.ts`) and the views they answer
  (`organisations/invitation-views.ts`).
  `PendingInvitations` (`invitations/`, through its `index.ts`: the store, the token reader, the
  seven-day lifetime and the link to the front's `/invitation` screen), `InvitationMails` and the
  `InvitationMailer` interface it implements (`invitations/mails.ts`, `invitations/mailer.ts`).
- `regionDatabases` (`region-databases.ts`): the database of each region, for the region hub.
- Queries: `surql/` (organisations, memberships, members, invitations, the organisation
  database's schema, a departing identity's memberships and the removal of a whole organisation).
- Built by the composition root, `src/composition/root.ts`; the sync registry hears the
  membership changes.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`organisations/service.spec.ts`,
  `account-departure.spec.ts`, `organisation.routes.spec.ts`, `organisation.limits.spec.ts`,
  `organisation-rows.spec.ts`, `region-databases.spec.ts`, `tenant-databases.spec.ts`,
  `organisations/invitations.spec.ts`, `invitations/token.spec.ts`, `invitations/pending.spec.ts`,
  `invitations/mails.spec.ts`), each organisation on an embedded in-memory database of its own.
- `bun run test:db` (the smoke) drives the organisation path against a stand.
