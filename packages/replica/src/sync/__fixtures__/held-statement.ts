import type { LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'

/** A database that holds `statement` once `holding` is set, until `release`; `reached` resolves once held. */
export function holdOn(statement: string) {
  let release = (): void => {}
  let reach = (): void => {}
  const gate = { holding: false }
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    reach = resolve
  })
  const wrap = (local: LocalDb) =>
    interceptQueries(local, (text) => {
      if (gate.holding && text === statement) {
        reach()

        return held
      }
    })

  return { gate, wrap, reached, release }
}
