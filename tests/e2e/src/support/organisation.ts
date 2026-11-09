import { expect, type Page } from '@playwright/test'

import type { Mail } from '@workspace/mailbox'

import { toast } from './fixtures'
import { expectDeclaredMail, type MailValues, openDeclaredMail } from './mail-contract'
import { mailbox } from './mailbox'

/** The role an invitation gives, or a member holds. */
export type Role = 'member' | 'admin'

/** The item of the note whose text holds `text`. */
export const noteItem = (device: Page, text: string) =>
  device.getByTestId('organisation.notes.item').filter({ hasText: text })

/** The items of the members list of an administrator's "/org" page. */
export const memberItems = (page: Page) =>
  page.getByTestId('organisation.members.list').getByTestId('organisation.members.item')

/** The items of the invitations sent and not accepted yet, on an administrator's "/org" page. */
export const sentItems = (page: Page) =>
  page.getByTestId('organisation.sent.list').getByTestId('organisation.sent.item')

/** The item of the invitation received from the organisation named `organisationName`. */
export const receivedItem = (page: Page, organisationName: string) =>
  page.getByTestId('organisation.received.item').filter({ hasText: organisationName })

/**
 * Creates the organisation from the open "/org" page: the heading then names it and the role
 * badge says the creator administers it.
 */
export async function createOrganisation(
  page: Page,
  organisation: { readonly key: string; readonly name: string },
): Promise<void> {
  await page.getByTestId('organisation.create.key-input').fill(organisation.key)
  await page.getByTestId('organisation.create.name-input').fill(organisation.name)
  await page.getByTestId('organisation.create.submit-button').click()
  await expect(page.getByTestId('organisation.page.heading')).toHaveText(organisation.name)
  await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
    'data-value',
    'admin',
  )
}

/**
 * The members list of an administrator's page holds exactly the accounts at `emails`, each in an
 * item of its own: an item shows its email beside its role select, so the email is looked for in
 * it, not matched as its whole text.
 */
export async function expectMembers(page: Page, emails: readonly string[]): Promise<void> {
  await expect(memberItems(page)).toHaveCount(emails.length)

  for (const email of emails) {
    await expect(memberItems(page).filter({ hasText: email })).toHaveCount(1)
  }
}

/**
 * Invites the email `email` from the open "/org" page of an administrator, with `role` when given
 * (the form's own, member, otherwise): the toast `invited`, then the email in the invitations
 * sent. The email may have an account or none.
 */
export async function inviteEmail(page: Page, email: string, role?: Role): Promise<void> {
  await page.getByTestId('organisation.invite.email-input').fill(email)

  if (role !== undefined) {
    await page.getByTestId('organisation.invite.role-select').click()
    await page
      .locator(`[data-testid="organisation.invite.role-select.option"][data-value="${role}"]`)
      .click()
  }

  await page.getByTestId('organisation.invite.submit-button').click()
  await expect(toast(page, 'invited')).toBeVisible()
  await expect(sentItems(page).filter({ hasText: email })).toBeVisible()
}

/**
 * Opens "/org" through the navigation, accepts the invitation of the organisation named
 * `organisationName` from the list of those received, and waits for the toast
 * `invitation-accepted` and for the page to show the organisation. The toast is watched while the
 * heading is, so its short life is not spent first.
 */
export async function acceptOnOrg(page: Page, organisationName: string): Promise<void> {
  await page.getByTestId('app-shell.nav.organisation-link').click()
  await receivedItem(page, organisationName)
    .getByTestId('organisation.received.accept-button')
    .click()
  await Promise.all([
    expect(toast(page, 'invitation-accepted')).toBeVisible(),
    expect(page.getByTestId('organisation.page.heading')).toHaveText(organisationName, {
      timeout: 10_000,
    }),
  ])
}

/** What a test knows of an invitation's mail: the invited email and the account that invited. */
export interface InvitationMail {
  readonly email: string
  /** The signed-in administrator who invited: its email and the language it uses. */
  readonly inviter: { readonly email: string; readonly language: string }
  /**
   * The language of the account the invited email belongs to; given only when it has an account.
   * An email with none gets its mail in the inviter's language.
   */
  readonly recipientLanguage?: string
}

/** What the invitation mail's declaration is checked against: the email, the inviter, the recipient. */
function valuesOf({ email, inviter, recipientLanguage }: InvitationMail): MailValues {
  return {
    params: { email },
    account: { email: inviter.email, language: inviter.language },
    ...(recipientLanguage === undefined ? {} : { recipient: { language: recipientLanguage } }),
  }
}

/**
 * Waits for the invitation mail to `invitation.email` after its first `seen` mails, `seen` the
 * count of that address's mails taken before the invitation, and holds it to its declaration.
 */
export async function expectInvitationMail(
  invitation: InvitationMail,
  seen: number,
): Promise<Mail> {
  const mail = await mailbox.next(invitation.email, seen)

  expectDeclaredMail(mail, 'organisations.invite', valuesOf(invitation))

  return mail
}

/**
 * As `expectInvitationMail`, then opens the mail's link in `page`.
 */
export function openInvitationMail(
  page: Page,
  invitation: InvitationMail,
  seen: number,
): Promise<Mail> {
  return openDeclaredMail(page, 'organisations.invite', valuesOf(invitation), seen)
}
