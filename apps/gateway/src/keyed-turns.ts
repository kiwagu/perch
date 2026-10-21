/**
 * Runs work one turn at a time per key: a turn starts once every turn asked before it under the
 * same key has settled, whatever its outcome, while turns of other keys run beside it. A key
 * whose last turn settled is forgotten. It orders the work of one process only.
 */
export class KeyedTurns<K> {
  /** The last turn of each key, settled whatever its outcome, which the next one waits for. */
  readonly #turns = new Map<K, Promise<void>>()

  /** How many keys have a turn under way or waiting. */
  get size(): number {
    return this.#turns.size
  }

  /** Runs `work` once the turns of `key` asked before it settled; ends as `work` does. */
  run<T>(key: K, work: () => PromiseLike<T>): Promise<T> {
    const turn = (this.#turns.get(key) ?? Promise.resolve()).then(work)
    const settled = turn.then(
      () => undefined,
      () => undefined,
    )

    this.#turns.set(key, settled)
    void settled.then(() => {
      if (this.#turns.get(key) === settled) {
        this.#turns.delete(key)
      }
    })

    return turn
  }
}
