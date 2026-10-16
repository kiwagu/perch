/**
 * Measures the replica on this machine: document size and write time for 1000
 * commands, and the time to project 1000 records into an embedded database.
 *
 * Usage: bun run packages/replica/scripts/measure.ts
 */

import { openTestDb } from '@workspace/data/testing'
import { profileIdFactory, userIdFactory } from '@workspace/ids'

import { createProfile, profileSchema, updateName } from '../src/__fixtures__/profile'
import { Projector } from '../src/projector'
import { RegionDoc } from '../src/region-doc'
import { LoroWritePath } from '../src/write-path'

const COUNT = 1000

const elapsed = (start: number): number => Math.round((performance.now() - start) * 10) / 10

const kib = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10

async function writeMany(): Promise<Record<string, number>> {
  const region = RegionDoc.inMemory('private')
  const path = new LoroWritePath(region, profileSchema)
  const start = performance.now()

  for (let index = 0; index < COUNT; index++) {
    const created = await path.run(createProfile, {
      id: profileIdFactory.create(),
      user: userIdFactory.create(),
      name: `Person ${index}`,
      email: `person${index}@example.test`,
    })

    created._unsafeUnwrap()
  }

  return {
    createCommandsMs: elapsed(start),
    snapshotKiB: kib(region.doc.export({ mode: 'snapshot' }).byteLength),
    updatesKiB: kib(region.doc.export({ mode: 'update' }).byteLength),
  }
}

async function editOne(): Promise<Record<string, number>> {
  const region = RegionDoc.inMemory('private')
  const path = new LoroWritePath(region, profileSchema)
  const id = profileIdFactory.create()

  ;(
    await path.run(createProfile, {
      id,
      user: userIdFactory.create(),
      name: 'Ann',
      email: 'ann@example.test',
    })
  )._unsafeUnwrap()

  const start = performance.now()

  for (let index = 0; index < COUNT; index++) {
    ;(await path.run(updateName, { id, name: `Ann ${index}` }))._unsafeUnwrap()
  }

  return {
    renameCommandsMs: elapsed(start),
    renamedSnapshotKiB: kib(region.doc.export({ mode: 'snapshot' }).byteLength),
  }
}

async function projectMany(): Promise<Record<string, number>> {
  const region = RegionDoc.inMemory('private')
  const path = new LoroWritePath(region, profileSchema)

  for (let index = 0; index < COUNT; index++) {
    ;(
      await path.run(createProfile, {
        id: profileIdFactory.create(),
        user: userIdFactory.create(),
        name: `Person ${index}`,
        email: `person${index}@example.test`,
      })
    )._unsafeUnwrap()
  }

  const local = (await openTestDb())._unsafeUnwrap()
  const failures: string[] = []
  const projector = new Projector(region, local, profileSchema, {
    onError: (error) => failures.push(error.message),
  })
  const start = performance.now()
  const stop = projector.start()
  const projected = await projector.flush()

  if (projected.isErr()) {
    throw new Error(projected.error.message)
  }

  const projectMs = elapsed(start)

  stop()
  await local.close()

  if (failures.length > 0) {
    throw new Error(`${failures.length} projections failed: ${failures[0]}`)
  }

  return { projectRecordsMs: projectMs }
}

const results = {
  count: COUNT,
  ...(await writeMany()),
  ...(await editOne()),
  ...(await projectMany()),
}

console.log(JSON.stringify(results, null, 2))
