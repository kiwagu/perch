import { z } from '@workspace/zod'

const address = z.union([z.ipv4(), z.ipv6()])

/** The address a request comes from: the rightmost X-Forwarded-For entry, else the socket peer. */
export function clientAddress(request: Request, peer: string | undefined): string {
  const entries = request.headers.get('X-Forwarded-For')?.split(',') ?? []
  const parsed = address.safeParse(entries.at(-1)?.trim())

  return parsed.success ? parsed.data : (peer ?? 'unknown')
}
