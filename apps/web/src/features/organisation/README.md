# Organisations (module `organisation`)

## Role in the architecture

The platform's organisation module on the device: the identity's memberships, creating an
organisation, the current organisation's members for an administrator, invitations and
removals, and the shared notes of the current organisation as the first table of the tenant
region. `domain/` holds the organisation entity (the name bound) and one file per rule
(`tenant-key.rule.ts`, `organisation-name.rule.ts`); `application/` the organisation and
notes services and the page's machine (`organisation.machine.ts`). Reads and writes go to the current organisation's database. The write rules declared
on the replica schema are applied on the device before a command runs
(`OrganisationService.ability()`), the same rule the gateway applies on its fork.

## Surface

- Route: `/org` (guard `authenticated`) renders `OrganisationPage`.
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
  members card with the invite form) and `OrganisationErrorLine` (a refused change as its
  contract code and its copy), in `presentation/components/`; the page's `useMembers` hook
  (the members as last read, for an administrator) sits beside its view.
- Providers: `NOTES_SERVICE`, `ORGANISATION_SERVICE`.
- i18n namespace `organisation.*`.
- Anchors: screen `organisation` in `contract/domain/screens/org.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/organisation.machine.ts`,
  held to `contract/domain/screens/org.yaml` by `platform/machines.spec.ts`) through the
  platform's `useScreenMachine`: the create form, the notes' items, the invitation, the members
  and the new note are its regions, a write is an invoke of its action, a control is enabled
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
  (`note:FORBIDDEN`). An administrator also sees the members, invites an existing account by
  email and removes a member. The page follows the memberships as they change, without a
  reload. A refused change the gateway limits (`rate-limited`) is worded as "too many attempts".

## Commands

- `bun run test` in `apps/web` runs this module's specs.
- `bun run model` and `bun run model:check` regenerate and verify the models of its `.surql`
  files.
