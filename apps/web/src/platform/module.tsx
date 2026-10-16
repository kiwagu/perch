/**
 * Angular-like modules on React: a module declares the services it provides,
 * its pages and their routes. `ModuleScope` gives the module its own child
 * container, so services resolve per module and fall back to the application's.
 */

import {
  createContext,
  type FunctionComponent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { Shape } from '@workspace/data'
import type { Container, Token } from '@workspace/di'
import type { Catalog } from '@workspace/i18n'

import { useServices } from './services'

export interface ProviderDef<T> {
  readonly provide: Token<T>
  readonly useFactory: (container: Container) => T
}

export interface RouteDef {
  readonly path: string
  /** The key of the page component in `declarations`. */
  readonly page: string
  /** Pages behind `authenticated` redirect to sign-in when nobody is signed in. */
  readonly guard?: 'authenticated' | 'guest'
}

export interface ModuleDef {
  readonly id: string
  readonly imports: readonly ModuleDef[]
  readonly providers: readonly ProviderDef<unknown>[]
  readonly declarations: Readonly<Record<string, FunctionComponent>>
  readonly routes: readonly RouteDef[]
  readonly i18n?: { readonly en: () => Promise<Catalog>; readonly es: () => Promise<Catalog> }
}

export interface ModuleInput extends Omit<ModuleDef, 'imports' | 'providers'> {
  readonly imports?: readonly ModuleDef[]
  readonly providers?: readonly ProviderDef<unknown>[]
}

export function defineModule(input: ModuleInput): ModuleDef {
  return { ...input, imports: input.imports ?? [], providers: input.providers ?? [] }
}

const ScopeContext = createContext<Container | undefined>(undefined)

export function ModuleScope(props: { readonly module: ModuleDef; readonly children: ReactNode }) {
  const scoped = useContext(ScopeContext)
  const { container: root } = useServices()
  const parent = scoped ?? root
  const container = useMemo(() => {
    const child = parent.child()

    for (const provider of props.module.providers) {
      child.singleton(provider.provide, provider.useFactory)
    }

    return child
  }, [parent, props.module])

  return <ScopeContext.Provider value={container}>{props.children}</ScopeContext.Provider>
}

/** A service of the nearest module scope, or of the application when outside any module. */
export function useService<T>(key: Token<T>): T {
  const scoped = useContext(ScopeContext)
  const services = useServices()

  return (scoped ?? services.container).get(key)
}

export interface ShapeState<T> {
  readonly tree: T | undefined
  readonly status: 'idle' | 'loading' | 'ready'
}

/** Keeps a component on the current tree of a shape; null parameters mean nothing to read yet. */
export function useShape<Params, Result>(
  shape: Shape<Params, Result>,
  params: Params | null,
): ShapeState<Result> {
  const { runner } = useServices()
  const [state, setState] = useState<ShapeState<Result>>({
    tree: undefined,
    status: params === null ? 'idle' : 'loading',
  })
  const key = JSON.stringify(params)

  useEffect(() => {
    if (params === null) {
      setState({ tree: undefined, status: 'idle' })

      return undefined
    }

    setState((current) => ({ tree: current.tree, status: 'loading' }))

    return runner.watch(shape, params, (tree) => setState({ tree, status: 'ready' }))
    // `key` stands for `params`: callers pass a fresh object on every render.
  }, [runner, shape, key])

  return state
}
