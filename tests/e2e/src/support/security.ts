import type { BrowserContext, ConsoleMessage, Response, Route } from '@playwright/test'

/**
 * The security headers the front sends with every response, exactly as the stands' Caddyfile
 * writes them. A page or a script that comes without one of them, or with another value, is a
 * problem of the test that loaded it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'x-content-type-options': 'nosniff',
}

/** How a violation of the policy reads on the console, the browser's own words or the listener's. */
const VIOLATION = /Content Security Policy/i

/** The responses whose headers set what a page or a worker may do: documents and scripts. */
const POLICY_CARRIERS = new Set(['document', 'script'])

/** The search parameter that marks a worker's script, with the kind of the worker as its value. */
const WORKER_MARK = 'e2e-csp-worker'

/** The test's own module, on the front's origin, that a module worker imports before its code. */
const LISTENER_PATH = '/__e2e/csp-listener.js'

/**
 * Says each violation a page or a worker meets on its console. The browser puts some of them on
 * the console by itself, but not all (a refused WASM compilation is only an exception and this
 * event), and a worker's never reach the test's console: every one goes through this event.
 */
const LISTENER =
  "self.addEventListener('securitypolicyviolation', (event) => console.error('Content Security Policy violation in ' + (typeof document === 'undefined' ? 'a worker' : 'a page') + ': ' + event.effectiveDirective + ' refused ' + (event.blockedURI || 'inline') + ' at ' + event.sourceFile + ':' + event.lineNumber))"

/**
 * Runs in every page before its own scripts: the listener, and a mark on the script of each
 * worker the page starts, so the route below can put the listener before the worker's code.
 */
const IN_EVERY_PAGE = `${LISTENER};
(() => {
  const Native = self.Worker
  self.Worker = class extends Native {
    constructor(url, options) {
      const marked = new URL(url, location.href)
      marked.searchParams.set('${WORKER_MARK}', options?.type === 'module' ? 'module' : 'classic')
      super(marked, options)
    }
  }
})()`

/** What a browser context reported against the front's security policy while a test ran. */
export interface SecurityWatch {
  /** The problems so far, each once. */
  problems(): readonly string[]
}

/**
 * Watches one browser context for the rest of the test, before it opens a page: every CSP
 * violation its pages and their workers meet, and every document or script of the front that
 * lacks one of `SECURITY_HEADERS`.
 */
export async function watchSecurity(
  context: BrowserContext,
  front: string,
): Promise<SecurityWatch> {
  const found = new Set<string>()

  context.on('console', (message: ConsoleMessage) => {
    if (VIOLATION.test(message.text())) {
      found.add(`CSP violation: ${message.text()}`)
    }
  })
  context.on('response', (response: Response) => {
    if (
      new URL(response.url()).origin === front &&
      POLICY_CARRIERS.has(response.request().resourceType())
    ) {
      checkHeaders(response, found)
    }
  })
  await context.addInitScript(IN_EVERY_PAGE)
  await context.route(
    (url) => url.origin === front && url.searchParams.has(WORKER_MARK),
    listenFirst,
  )
  await context.route(`${front}${LISTENER_PATH}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: { ...SECURITY_HEADERS },
      body: LISTENER,
    }),
  )

  return { problems: () => [...found] }
}

/** Serves a worker's script as the front sends it, with the listener first. */
async function listenFirst(route: Route): Promise<void> {
  const kind = new URL(route.request().url()).searchParams.get(WORKER_MARK)
  // A module worker evaluates its imports before its own code: the listener is imported first.
  const first = kind === 'module' ? `import '${LISTENER_PATH}';\n` : `${LISTENER};\n`
  const response = await route.fetch()

  await route.fulfill({ response, body: first + (await response.text()) })
}

function checkHeaders(response: Response, found: Set<string>): void {
  const headers = response.headers()
  const where = `${new URL(response.url()).pathname} (${response.status()})`

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (headers[name] !== value) {
      found.add(`${where}: ${name} is ${headers[name] ?? 'missing'}`)
    }
  }
}
