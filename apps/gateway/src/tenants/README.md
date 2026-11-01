# Organisations (module `tenants`)

## Role in the architecture

The gateway's organisations: each organisation's own database, the directory's rows of who
belongs to it, the services that create organisations and change their members, and the
routes over them. It also tells the region hub where each region lives
(`region-databases.ts`). It has no domain rules of its own, so no `domain/` or `application/`
folders, and no `index.ts` yet: it predates the index rule and is imported file by file.

Organisations live in the same namespace, each in a strict database `t_<key>` of its own that
the gateway defines; the directory holds each organisation (`tenant`) and who belongs to it
(`membership`), and the organisation's database holds its `member` rows. Two services of this
module, built by the composition root over the directory, serve them; on shutdown the
organisations' databases close after the region hub and before the directory. `TenantDatabases`
keeps one connection per organisation database in use, shared by every holder and closed once
nobody has held it for five minutes; once closed at shutdown it hands out none. `Organisations` creates an organisation (its directory
rows, its database, its creator as admin member there, then ready; a creation its creator left
unfinished, or whose listeners failed to hear it, is completed when the creator asks again), lists an identity's memberships in ready
organisations by key, lets an admin invite an existing identity by email and remove a member
other than itself, lists the members with their emails to an admin (leaving out the rows of
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
creations, the invites of it, its removals) run one after the other, each once the one before
it and its notification have settled, so the directory and the organisation's database end as
the last change left them and its devices hear the lists in that order. This holds within one
gateway process; gateways in several processes would need a durable revision of the memberships.
`Organisations` reads the directory through `OrganisationLookup` and an organisation's `member`
rows through `TenantMembers`; `KeyedTurns` (`src/keyed-turns.ts`) runs one identity's changes
one at a time.

The organisation routes (`organisation.routes.ts`) are Bearer calls (`src/auth/README.md`).
`GET /organisations` lists the
caller's memberships; `POST /organisations` with `{ key, name }` creates an organisation with
the caller as its admin (201); `GET /organisations/:key/members` lists the members to an admin
(403 `not-admin` to a member); `POST /organisations/:key/members` with `{ email }` lets an admin
invite an identity; and `DELETE /organisations/:key/members/:identity` lets an admin remove a
member (204). A body or an identity that does not follow its schema answers 400 (`bad-request`);
a refusal answers its code, with 400 for `invalid-key` and `invalid-name`, 403 for
`not-a-member` and `not-admin`, 404 for `no-such-tenant` and `no-such-identity`, and 409 for
`key-taken`, `already-member` and `self`; an invitation or a creation over its limit answers 429
(`rate-limited`, see `src/limits/README.md`); a failure of the gateway answers 500 (`internal`).

## Surface

- Routes: `GET /organisations`, `POST /organisations`, `GET /organisations/:key/members`,
  `POST /organisations/:key/members`, `DELETE /organisations/:key/members/:identity`
  (`organisation.routes.ts`).
- Services: `Organisations` (`organisations.ts`), `TenantDatabases` (`tenant-databases.ts`),
  `OrganisationLookup` (`organisation-lookup.ts`), `TenantMembers` (`tenant-members.ts`), the
  refusal codes (`organisation-refusal.ts`) and the rows they read (`organisation-rows.ts`).
- `regionDatabases` (`region-databases.ts`): the database of each region, for the region hub.
- Queries: `surql/` (organisations, memberships, members, the organisation database's schema).
- Built by the composition root, `src/composition/root.ts`; the sync registry hears the
  membership changes.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`organisations.spec.ts`,
  `organisation.routes.spec.ts`, `organisation.limits.spec.ts`, `organisation-rows.spec.ts`,
  `region-databases.spec.ts`, `tenant-databases.spec.ts`), each organisation on an embedded
  in-memory database of its own.
- `bun run test:db` (the smoke) drives the organisation path against a stand.
