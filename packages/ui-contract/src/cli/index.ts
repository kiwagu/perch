#!/usr/bin/env bun
/** The `ui-contract` bin: runs the command its arguments name (`run.ts`) and exits with its code. */

import { run } from './run'

process.exit(run(process.argv.slice(2)))
