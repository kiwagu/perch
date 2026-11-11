# Organisations (module `organisation`)

## Role in the architecture

The platform's organisation module on the device: the identity's memberships, creating an
organisation, the current organisation's members for an administrator, invitations and
removals, and the shared notes of the current organisation as the first table of the tenant
region. `domain/` holds the organisation entity (the name bound) and one file per rule
(`tenant-key.rule.ts`, `organisation-name.rule.ts`); `application/` the organisation and
notes services and the machines of the two pages (`organisation-machine/`, `invitation.machine.ts`). Reads and writes go to the current organisation's database. The write rules declared
on the replica schema are applied on the device before a command runs
(`OrganisationService.ability()`), the same rule the gateway applies on its fork.

## Surface

- Routes: `/org` (guard `authenticated`) renders `OrganisationPage`; `/invitation?token` (open to
  anyone) renders `InvitationPage`, the page the link of an invitation mail opens.
- Shape `organisation.shape.surql`: the notes of the current organisation (`note`, tenant
  region), oldest first.
- Commands `organisation.commands.surql`: `createNote`, `updateNote`, `deleteNote`, all in
  the tenant region. Creating an organisation, inviting an email with a role, listing and
  revoking the pending invitations, changing a member's role and removing a member go through
  the gateway's `/organisations` routes via the `ORGANISATIONS` port, not through the replica;
  reading the invitation a link carries, listing the invitations to the account, accepting and
  declining one go through the `INVITATIONS` port (`OrganisationService.accept` selects the
  organisation once its membership is adopted).
- Components: `OrganisationCreate` (the form that creates an organisation),
  `OrganisationNotes` (the notes card with its new note form), `OrganisationMembers` (the
  members card: each member's role select and remove button), `OrganisationInvite` (the form
  that invites an email with a role, under the members), `OrganisationSent` (the invitations
  not accepted yet, with the link to copy and the revoke button), `OrganisationReceived` (the
  invitations for the account, with accept and decline) and `OrganisationErrorLine` (a
  refused change as its contract code and its copy), in `presentation/components/`;
  `roleShown` (the role a member's row shows) and `useInviteDraft` (the invitation form's
  fields, which the flow empties) sit beside the page's view, which reads the members, the
  invitations sent and the invitations for the account through the platform's `useListed` (a
  list as last read, and the change it settled after).
- Providers: `NOTES_SERVICE`, `ORGANISATION_SERVICE`.
- i18n namespace `organisation.*`.
- Anchors: screens `organisation` in `contract/domain/screens/org.yaml` and
  `organisation.invitation` in `contract/domain/screens/invitation.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/organisation-machine/`,
  held to `contract/domain/screens/org.yaml` by `platform/machines.spec.ts`) through the
  platform's `useScreenMachine`: the create form, the notes' items, the invitation, the members
  and their roles, the invitations sent and received, and the new note are its regions, a write is an invoke of its action, a control is enabled
  while the machine's state handles its event, and the machine keeps the codes of the page's
  errors with the organisation they were refused in. Without memberships the page offers to
  create an organisation (a key checked by the kernel's `isTenantKey`, a name of at most 80
  characters); the creator becomes its administrator and the new organisation the current one;
  closed by its toggle, the create form is only hidden and keeps what was typed. With several
  memberships the page offers a choice, which applies at once (`holdsInput={false}`), after
  the frame's guard of unsaved input asks while a field holds some (the hook asks it before
  the select's event). Choosing another organisation, or creating one, starts every area
  afresh; the forms' drafts belong to their organisation. One note is edited at a time:
  opening another note's edit form, or deleting another note, closes the open one and drops
  what was typed into it. Every form is
  the kit's `Form`, whose saved submit leaves its fields with nothing unsaved. Notes are at most 500 characters. A member edits and deletes only its own
  notes and an administrator any, so "Edit" and "Delete" appear only where allowed, the
  member's own notes are marked "Yours", and a change the rules forbid is explained
  (`note:FORBIDDEN`). An administrator also sees the members, each with a role select that
  applies at once (the administrator's own included while another administrator stays; the
  row shows the role being set while the change runs and, once it is done, until the members
  read after it settle, the listed role after a refusal; a role being set shows only in the
  organisation it is set in), invites an email by a mailed link
  with a role (the account may not exist yet; the form empties once it is sent, only while the
  organisation it was sent in is still current), copies the link of or
  revokes an invitation not accepted yet (the clipboard is the `CLIPBOARD` port), and removes
  a member. The members and the invitations sent are read when they start to show (the page
  opening, the account made an administrator) and again after each change made here that
  touches them: the members after a removal or a role change (not after the account's own
  demotion, whose role comes over the sync channel), the invitations sent after an invite or a
  revoke. Every account sees the invitations to its email above the create form, read when the
  page opens and after each accept or decline, refused or not, and accepts one (its
  organisation becomes current) or declines it; a failed accept or decline shows beside that
  list, a failed read in place of it. The page follows the memberships as they change,
  without a reload. A refused change the gateway limits (`rate-limited`) is worded as "too many
  attempts".

## The invitation page

`InvitationPage` runs its screen's flow as its machine (`application/invitation.machine.ts`, held
to `contract/domain/screens/invitation.yaml` by `platform/machines.spec.ts`) over the token of its
address, through `useScreenMachine`; another token starts afresh, and an address without one is a
link that does not work, which the gateway is not asked about. It reads the link
(`OrganisationService.readInvitation`) and shows the organisation's name and the role, never the
email the invitation went to. The account the invitation is for (the gateway's `forYou`) accepts
(it becomes a member, its organisation current, and the app moves to `/org`) or declines (the app
moves to `/org`); nobody signed in here is asked to sign in first, with the link to the sign-in
page, and another account signed in is told the invitation is not its own, with no button either
way. A link that does not work (`link-invalid`, `link-expired`, or an invitation gone meanwhile)
says so with no button; any other refusal of a press says why and leaves the buttons for another.
The error shows one of the contract's codes: a refusal the flow does not list for the transition
is `failed`. The accept button leaves the page (`platform/leaving.ts`).

## Commands

- `bun run test` in `apps/web` runs this module's specs.
- `bun run model` and `bun run model:check` regenerate and verify the models of its `.surql`
  files.
