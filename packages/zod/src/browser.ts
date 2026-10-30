/**
 * The shared Zod instance as a browser build takes it (the package's `browser` condition): it
 * never evaluates a string as code. To compile a faster parser for each object schema, Zod first
 * probes whether `Function` may run a string, and a Content-Security-Policy without
 * `'unsafe-eval'` refuses that probe as a violation. Without the compiled parser Zod parses the
 * same way. Every schema of the workspace takes `z` from this package, so the setting is in place
 * before the first one is defined; a server keeps the compiled parser.
 */
import { z } from './index'

z.config({ jitless: true })

export * from './index'
