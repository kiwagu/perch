// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Shape } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container, token } from '@workspace/di'

import { defineModule, ModuleScope, useService, useShape } from './module'
import { ServicesProvider, type ServicesView } from './services'

class Counter {
  readonly id = Math.random()
}

const COUNTER = token<Counter>('Counter')

const profileShape: Shape<{ id: string }, { name: string }> = {
  id: 'test.profile',
  kind: 'shape',
  text: '',
  params: [],
  tables: ['profile'],
}

const TestModule = defineModule({
  id: 'test',
  providers: [{ provide: COUNTER, useFactory: () => new Counter() }],
  declarations: {},
  routes: [],
})

function services(runner = new FakeShapeRunner()): ServicesView {
  return { container: new Container(), runner }
}

function TwoReads() {
  const first = useService(COUNTER)
  const second = useService(COUNTER)

  return <p>{first === second ? 'same' : 'different'}</p>
}

function Profile(props: { readonly id: string | null }) {
  const { tree, status } = useShape(profileShape, props.id === null ? null : { id: props.id })

  return <p>{`${status}:${tree?.name ?? '-'}`}</p>
}

describe('ModuleScope', () => {
  it('gives components the services its module provides, one instance each', () => {
    render(
      <ServicesProvider services={services()}>
        <ModuleScope module={TestModule}>
          <TwoReads />
        </ModuleScope>
      </ServicesProvider>,
    )

    expect(screen.getByText('same')).toBeTruthy()
  })
})

describe('useShape', () => {
  it('watches a shape, renders its trees and stops watching on unmount', () => {
    const runner = new FakeShapeRunner()
    const view = render(
      <ServicesProvider services={services(runner)}>
        <Profile id="prf_1" />
      </ServicesProvider>,
    )

    expect(screen.getByText('loading:-')).toBeTruthy()

    act(() => {
      runner.set(profileShape, { name: 'Ann' })
    })

    expect(screen.getByText('ready:Ann')).toBeTruthy()
    expect(runner.lastParams(profileShape)).toEqual({ id: 'prf_1' })

    view.unmount()

    expect(runner.watching(profileShape)).toBe(0)
  })

  it('stays idle without parameters', () => {
    render(
      <ServicesProvider services={services()}>
        <Profile id={null} />
      </ServicesProvider>,
    )

    expect(screen.getByText('idle:-')).toBeTruthy()
  })
})
