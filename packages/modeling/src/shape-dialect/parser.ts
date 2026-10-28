import { ModelingException } from '../errors'
import { isPunct, type Token } from '../tokenizer'

/** Reads a shape's tokens one at a time, with a look ahead and behind. */
export class Parser {
  #index = 0

  constructor(
    private readonly source: string,
    private readonly tokens: readonly Token[],
  ) {}

  get done(): boolean {
    return this.#index >= this.tokens.length
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.#index + offset]
  }

  next(): Token {
    const token = this.tokens[this.#index]

    if (!token) {
      throw new ModelingException('the shape ends too early')
    }

    this.#index++

    return token
  }

  expectPunct(text: string): void {
    const token = this.next()

    if (!isPunct(token, text)) {
      throw new ModelingException(`expected "${text}" but found "${token.text}"`)
    }
  }

  word(what: string): string {
    const token = this.next()

    if (token.kind !== 'word') {
      throw new ModelingException(`expected ${what} but found "${token.text}"`)
    }

    return token.text
  }

  /** The raw text of a parenthesised group, the opening "(" being the next token. */
  group(): string {
    const open = this.next()
    let depth = 1

    while (depth > 0) {
      const token = this.next()

      depth += isPunct(token, '(') ? 1 : isPunct(token, ')') ? -1 : 0

      if (depth === 0) {
        return this.source.slice(open.end, token.start).trim()
      }
    }

    return ''
  }

  rest(): string {
    const first = this.peek()

    return first ? this.source.slice(first.start).trim() : ''
  }
}
