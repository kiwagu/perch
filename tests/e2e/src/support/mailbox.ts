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
