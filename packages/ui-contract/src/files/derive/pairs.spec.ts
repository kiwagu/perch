import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Screen } from '../screens'

import { withDerivedPairGuards } from './pairs'

const FILE = 'contract/domain/screens/sample.yaml'
const PASSWORD = 'sample.password-input'
const CONFIRMATION = 'sample.password-confirmation-input'
const SUBMIT = 'sample.submit-button'

const SENTENCES = {
  passwordBreaksRules: 'the password breaks one of the rules of sample.password-rule-list',
  passwordsDiffer: 'the password typed again is not the same as the password',
  confirmationStrays: 'the password typed again is no longer how the password begins',
  confirmationFollows: 'the password typed again is how the password begins, or is empty',
}

const DERIVED = {
  passwordBreaksRules: { composite: 'breaks' },
  passwordsDiffer: { confirms: 'differs' },
  confirmationStrays: { confirms: 'strays' },
  confirmationFollows: { confirms: 'follows' },
}

/** The flow of a new password typed twice: it names all four guards, or three without `passwordsDiffer`. */
const flowOf = (guards: Record<string, unknown> | undefined, submitChecks = true) => ({
  initial: 'weak',
  ...(guards === undefined ? {} : { meta: { guards } }),
  states: {
    weak: {
      on: {
        [PASSWORD]: [
          { guard: 'passwordBreaksRules' },
          { target: 'differing', guard: 'confirmationStrays' },
          { target: 'kept' },
        ],
      },
    },
    kept: {
      on: {
        [PASSWORD]: [
          { target: 'weak', guard: 'passwordBreaksRules' },
          { target: 'differing', guard: 'confirmationStrays' },
        ],
        [CONFIRMATION]: { target: 'differing', guard: 'confirmationStrays' },
        [SUBMIT]: submitChecks
          ? [{ target: 'differing', guard: 'passwordsDiffer' }, { target: 'sending' }]
          : { target: 'sending' },
      },
    },
    differing: { on: { [CONFIRMATION]: { target: 'kept', guard: 'confirmationFollows' } } },
    sending: { invoke: { src: 'platform.sign-up', onDone: { target: 'done' } } },
    done: { type: 'final' },
  },
})

const PASSWORD_DEF = {
  kind: 'input',
  secret: true,
  composite: 'password-rules',
  binding: { action: 'platform.sign-up', params: { password: PASSWORD } },
}

const CONFIRMATION_DEF = { kind: 'input', secret: true, confirms: PASSWORD }

/** A screen setting a new password, its anchors overridden by `anchors`, with `flow` (`null`: none). */
const screenOf = (anchors: Record<string, unknown>, flow: unknown = flowOf(undefined)): Screen =>
  screenFileSchema.parse({
    id: 'sample',
    title: 'Sample',
    description: 'Sets a new password.',
    flag: null,
    bindings: [{ path: '/sample', roles: ['identity'] }],
    entry: ['sample.form'],
    anchors: {
      'sample.form': { kind: 'form' },
      [PASSWORD]: PASSWORD_DEF,
      [CONFIRMATION]: CONFIRMATION_DEF,
      [SUBMIT]: { kind: 'button', binding: { action: 'platform.sign-up' } },
      ...anchors,
    },
    ...(flow === null ? {} : { flow }),
  })

const derive = (screen: Screen, edition = 4) => withDerivedPairGuards(FILE, screen, edition)

const guardsOf = (screen: Screen) => screen.flow?.meta?.guards

const messagesOf = (screen: Screen, edition = 4) =>
  derive(screen, edition).problems.map(({ file, message }) => `${file}: ${message}`)

describe('withDerivedPairGuards', () => {
  it('derives the four guards its flow names from the confirmation, the screen as written holding none', () => {
    const written = screenOf({})
    const { screen, problems } = derive(written)

    expect(guardsOf(written)).toBeUndefined()
    expect(problems).toEqual([])
    expect(guardsOf(screen)).toEqual(DERIVED)
    expect(screen.anchors).toBe(written.anchors)
    expect(screen.flow?.states).toBe(written.flow?.states)
  })

  it('derives only the guards its flow names, so none is declared and unused', () => {
    const { passwordsDiffer: _unused, ...three } = DERIVED
    const { screen, problems } = derive(screenOf({}, flowOf(undefined, false)))

    expect(problems).toEqual([])
    expect(guardsOf(screen)).toEqual(three)
  })

  it('keeps the guards the screen writes, a sentence or failure codes, before the derived ones', () => {
    const written = { held: 'the settings are on this device', failing: { codes: ['failed'] } }
    const { screen, problems } = derive(screenOf({}, flowOf(written)))

    expect(problems).toEqual([])
    expect(guardsOf(screen)).toEqual({ ...written, ...DERIVED })
    expect(Object.keys(guardsOf(screen) ?? {})).toEqual([
      'held',
      'failing',
      ...Object.keys(DERIVED),
    ])
  })

  it('from version 4 refuses each name of the pair the screen writes beside its confirmation', () => {
    expect(
      messagesOf(screenOf({}, flowOf({ passwordsDiffer: SENTENCES.passwordsDiffer }))),
    ).toEqual([
      `${FILE}: flow.meta.guards.passwordsDiffer: derived from the confirms of ${CONFIRMATION}; leave it out`,
    ])
    expect(messagesOf(screenOf({}, flowOf(SENTENCES)), 5)).toHaveLength(4)
    expect(
      messagesOf(screenOf({}, flowOf({ passwordsDiffer: SENTENCES.passwordsDiffer }, false))),
    ).toEqual([
      `${FILE}: flow.meta.guards.passwordsDiffer: derived from the confirms of ${CONFIRMATION}; leave it out`,
    ])
  })

  it('before version 4 keeps a name of the pair the screen writes, and derives the others', () => {
    const { screen, problems } = derive(
      screenOf({}, flowOf({ passwordsDiffer: SENTENCES.passwordsDiffer })),
      3,
    )

    expect(problems).toEqual([])
    expect(guardsOf(screen)).toEqual({ ...DERIVED, passwordsDiffer: SENTENCES.passwordsDiffer })
  })

  it.each([1, 2, 3, 4])(
    'refuses a guard of a pair a screen file writes, with a pair or without, at version %i',
    (edition) => {
      const refusal = (name: string) =>
        `${FILE}: flow.meta.guards.${name}: a guard of a password pair is derived from its confirmation: a screen file never writes it`
      const written = {
        passwordsDiffer: { confirms: 'differs' },
        rulesBroken: { composite: 'breaks' },
      }

      expect(
        messagesOf(
          screenOf({ [CONFIRMATION]: { kind: 'input', secret: true } }, flowOf(written)),
          edition,
        ),
      ).toEqual([refusal('passwordsDiffer'), refusal('rulesBroken')])
      expect(messagesOf(screenOf({}, flowOf(written)), edition)).toContain(refusal('rulesBroken'))
    },
  )

  describe('a confirms that makes no pair is a problem, and derives nothing', () => {
    const misused = (anchors: Record<string, unknown>) => {
      const { screen, problems } = derive(screenOf(anchors))

      expect(guardsOf(screen)).toBeUndefined()

      return problems.map(({ message }) => message)
    }
    const at = (anchor: string, message: string) => `anchors["${anchor}"].confirms: ${message}`

    it('on anything but a secret input', () => {
      expect(misused({ [CONFIRMATION]: { kind: 'input', confirms: PASSWORD } })).toEqual([
        at(CONFIRMATION, 'only a secret input confirms another'),
      ])
      expect(
        misused({
          [CONFIRMATION]: { kind: 'textarea', secret: true, confirms: PASSWORD },
        }),
      ).toEqual([at(CONFIRMATION, 'only a secret input confirms another')])
    })

    it('on an input with a binding', () => {
      expect(
        misused({
          [CONFIRMATION]: {
            ...CONFIRMATION_DEF,
            binding: { action: 'platform.sign-up', params: { password: CONFIRMATION } },
          },
        }),
      ).toEqual([at(CONFIRMATION, 'a confirmation is never sent, so it has no binding')])
    })

    it('naming an input without a composite, one that is not secret, no anchor of the screen or itself', () => {
      const naming = (named: string) =>
        at(CONFIRMATION, `"${named}" is not another secret input of the screen with a composite`)
      const { composite: _composite, ...withoutComposite } = PASSWORD_DEF
      const { secret: _secret, ...notSecret } = PASSWORD_DEF

      expect(misused({ [PASSWORD]: withoutComposite })).toEqual([naming(PASSWORD)])
      expect(misused({ [PASSWORD]: notSecret })).toEqual([naming(PASSWORD)])
      expect(
        misused({ [CONFIRMATION]: { ...CONFIRMATION_DEF, confirms: 'sample.missing-input' } }),
      ).toEqual([naming('sample.missing-input')])
      expect(
        misused({
          [CONFIRMATION]: {
            ...CONFIRMATION_DEF,
            composite: 'password-rules',
            confirms: CONFIRMATION,
          },
        }),
      ).toEqual([naming(CONFIRMATION)])
    })

    it('a second one on the screen, the first making the pair', () => {
      const { screen, problems } = derive(
        screenOf({ 'sample.again-input': { kind: 'input', secret: true, confirms: PASSWORD } }),
      )

      expect(problems.map(({ message }) => message)).toEqual([
        at(
          'sample.again-input',
          `a screen holds one password pair, and ${CONFIRMATION} confirms already`,
        ),
      ])
      expect(guardsOf(screen)).toEqual(DERIVED)
    })
  })

  describe('a screen without a pair reads as it is written', () => {
    const withoutPair = screenOf(
      { [CONFIRMATION]: { kind: 'input', secret: true } },
      flowOf(SENTENCES),
    )

    it.each([1, 3, 4])('its four sentences stay as written at version %i', (edition) => {
      expect(guardsOf(withoutPair)).toEqual(SENTENCES)
      expect(derive(withoutPair, edition)).toEqual({ screen: withoutPair, problems: [] })
      expect(derive(withoutPair, edition).screen).toBe(withoutPair)
    })

    it('and a pair whose screen has no flow derives nothing', () => {
      const flowless = screenOf({}, null)

      expect(derive(flowless)).toEqual({ screen: flowless, problems: [] })
    })
  })
})
