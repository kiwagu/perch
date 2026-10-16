import type { ShapeRunnerPort } from '@workspace/data'

export const describePort = (port: ShapeRunnerPort | undefined): string =>
  port ? 'bound' : 'unbound'
