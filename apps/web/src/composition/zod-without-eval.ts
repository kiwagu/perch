/**
 * Zod in the browser never evaluates a string as code. To compile a faster parser for each object
 * schema, Zod first probes whether `Function` may run a string, and the front's
 * Content-Security-Policy, which allows no `'unsafe-eval'`, reports that probe as a violation on
 * every page. Without the compiled parser Zod parses the same way; the gateway keeps it.
 *
 * The start imports this module first: Zod reads the setting when an object schema is defined,
 * so it holds only for the schemas defined after it.
 */
import { z } from '@workspace/zod'

z.config({ jitless: true })
