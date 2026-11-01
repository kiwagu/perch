import { z } from '@workspace/zod'

/** A mail as MailDev's REST API answers it, as far as the suites read it. */
export const mailSchema = z.object({
  id: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  to: z.array(z.object({ address: z.string() })),
})

export type Mail = z.infer<typeof mailSchema>
