import { createContext, type ReactNode, useContext } from 'react'

import type { ShapeRunnerPort } from '@workspace/data'
import type { Container } from '@workspace/di'

/** What React code may reach of the application services: ports and the container that resolves them. */
export interface ServicesView {
  readonly container: Container
  readonly runner: ShapeRunnerPort
}

const ServicesContext = createContext<ServicesView | undefined>(undefined)

export function ServicesProvider(props: {
  readonly services: ServicesView
  readonly children: ReactNode
}) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  )
}

export function useServices(): ServicesView {
  const services = useContext(ServicesContext)

  if (!services) {
    throw new Error('a ServicesProvider must wrap the application')
  }

  return services
}
