import { expect } from '@playwright/test'

import { Mailbox } from '@workspace/mailbox'
import { z } from '@workspace/zod'

// `bun run test:e2e` runs Playwright through `mcproc exec`, which sets MAILBOX_URL to this
// checkout's maildev-e2e from the manifest's vars.
const MAILBOX_URL = z
  .url({
    protocol: /^https?$/,
    error:
      'MAILBOX_URL must be the http:// address of the maildev-e2e mailbox; run the suite with bun run test:e2e',
  })
  .parse(process.env['MAILBOX_URL'])

/** The e2e stand's mailbox: every mail its gateway sent, read through MailDev's REST API. */
export const mailbox = new Mailbox(MAILBOX_URL)

/**
 * The delivery window: how long after the gateway's answer to an action a mail the action made go
 * out is in the stand's mailbox. The gateway answers before its send ends (it does not await it),
 * and on the stand the mail is there within a second of the answer; the window is twice that.
 */
export const MAIL_DELIVERY_WINDOW_MS = 2_000

/** How often the mailbox is read during a delivery window. */
const LOOK_EVERY_MS = 200

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Bounded non-arrival: the mails to `address` stay `mails` from `answeredAt`, the moment the test
 * saw the answer to an action that must send none, until the delivery window after it has closed,
 * read every 200 ms, the last read after it closed. It shows that no mail came within the window,
 * not that none ever will. A failure names no address.
 */
export async function expectBoundedNonArrival(
  address: string,
  { mails, answeredAt }: { readonly mails: number; readonly answeredAt: number },
): Promise<void> {
  const closes = answeredAt + MAIL_DELIVERY_WINDOW_MS

  for (;;) {
    const readAt = Date.now()

    expect(
      await mailbox.count(address),
      `a mail came within ${MAIL_DELIVERY_WINDOW_MS} ms of the answer`,
    ).toBe(mails)

    if (readAt >= closes) {
      return
    }

    await pause(Math.min(LOOK_EVERY_MS, closes - readAt))
  }
}
