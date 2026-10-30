import type { BrowserContext, ConsoleMessage, Page, Response } from '@playwright/test'

/**
 * The security headers the front sends with every response, exactly as the stands' Caddyfile
 * writes them. A page or a script that comes without one of them, or with another value, is a
 * problem of the test that loaded it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'x-content-type-options': 'nosniff',
}

/** How the browser words a violation of the policy, enforced or report-only, in a page or a worker. */
const VIOLATION = /Content Security Policy/i

/** The responses whose headers set what a page or a worker may do: documents and scripts. */
const POLICY_CARRIERS = new Set(['document', 'script'])

/** What a browser context reported against the front's security policy while a test ran. */
export interface SecurityWatch {
  /** Waits for the header checks under way, then lists the problems, each once. */
  problems(): Promise<readonly string[]>
}

/**
 * Watches one browser context for the rest of the test: every CSP violation its pages and their
 * workers report on the console, and every document or script of the front that lacks one of
 * `SECURITY_HEADERS`.
 */
export function watchSecurity(context: BrowserContext, front: string): SecurityWatch {
  const found = new Set<string>()
  const checks: Promise<void>[] = []

  const onConsole = (message: ConsoleMessage): void => {
    if (VIOLATION.test(message.text())) {
      found.add(`CSP violation: ${message.text()}`)
    }
  }
  const onPage = (page: Page): void => {
    page.on('worker', (worker) => worker.on('console', onConsole))
  }
  const onResponse = (response: Response): void => {
    if (
      response.url().startsWith(front) &&
      response.ok() &&
      POLICY_CARRIERS.has(response.request().resourceType())
    ) {
      checks.push(checkHeaders(response, found))
    }
  }

  context.on('console', onConsole)
  context.on('page', onPage)
  context.on('response', onResponse)
  for (const page of context.pages()) {
    onPage(page)
  }

  return {
    problems: async () => {
      await Promise.all(checks)

      return [...found]
    },
  }
}

async function checkHeaders(response: Response, found: Set<string>): Promise<void> {
  const headers = await response.allHeaders().catch(() => undefined)

  // A page closed while the response was read: its headers are gone with it.
  if (headers === undefined) {
    return
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (headers[name] !== value) {
      found.add(`${new URL(response.url()).pathname}: ${name} is ${headers[name] ?? 'missing'}`)
    }
  }
}
