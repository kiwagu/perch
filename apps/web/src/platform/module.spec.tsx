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

function Profile(props: { readonly id: string | null; readonly renders?: string[] }) {
  const { tree, status } = useShape(profileShape, props.id === null ? null : { id: props.id })
  const shown = `${status}:${tree?.name ?? '-'}`

  props.renders?.push(`${props.id ?? 'none'} ${shown}`)

  return <p>{shown}</p>
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

  it('gives out no tree read for other parameters, from the render they change in', () => {
    const runner = new FakeShapeRunner()
    const provided = services(runner)
    const renders: string[] = []
    const view = render(
      <ServicesProvider services={provided}>
        <Profile id="prf_1" renders={renders} />
      </ServicesProvider>,
    )

    act(() => {
      runner.set(profileShape, { name: 'Ann' })
    })
    view.rerender(
      <ServicesProvider services={provided}>
        <Profile id="prf_2" renders={renders} />
      </ServicesProvider>,
    )

    // The fake runner pushes the tree it holds to any watcher, so prf_2 is shown Ann once read.
    expect(renders.find((shown) => shown.startsWith('prf_2'))).toBe('prf_2 loading:-')
    expect(runner.lastParams(profileShape)).toEqual({ id: 'prf_2' })

    view.rerender(
      <ServicesProvider services={provided}>
        <Profile id={null} renders={renders} />
      </ServicesProvider>,
    )

    expect(new Set(renders.filter((shown) => shown.startsWith('none')))).toEqual(
      new Set(['none idle:-']),
    )
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
