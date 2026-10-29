import { describe, expect, it } from 'vitest'

import { LatencyBook } from './latency-book'

describe('LatencyBook', () => {
  it('measures a push to its ack and to each reader that received its head', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 2)
    book.acked('w1', 1, 'tenant:a', 7, 1040)
    book.received('tenant:a', 7, 1055)
    book.received('tenant:a', 7, 1070)
    book.received('tenant:a', 99, 2000)

    expect(book.finalize(epoch)).toEqual({
      ack: [40],
      fanout: [55, 70],
      pushes: 1,
      expected: 2,
      unacked: 0,
      undelivered: 0,
    })
  })

  it('keeps a receipt that lands before its ack: the same sample as one after', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 2)
    book.received('tenant:a', 7, 1020)
    book.acked('w1', 1, 'tenant:a', 7, 1040)
    book.received('tenant:a', 7, 1055)

    expect(book.finalize(epoch).fanout).toEqual([20, 55])
  })

  it('scopes a head to its region: two regions with one head number do not cross', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.pushed('w2', 1, 'tenant:b', 2000, 1)
    book.acked('w1', 1, 'tenant:a', 1, 1010)
    book.acked('w2', 1, 'tenant:b', 1, 2010)
    book.received('tenant:a', 1, 1030)
    book.received('tenant:b', 1, 2050)
    book.received('tenant:c', 1, 3000)

    expect(book.finalize(epoch).fanout).toEqual([30, 50])
  })

  it('attributes a late ack to the epoch of its push', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)

    const second = book.startEpoch()

    book.acked('w1', 1, 'tenant:a', 1, 1500)
    book.received('tenant:a', 1, 1600)

    expect(book.finalize(second)).toMatchObject({ ack: [], fanout: [], pushes: 0 })
    expect(book.finalize(first)).toMatchObject({ ack: [500], fanout: [600], pushes: 1 })
  })

  it('keeps an early receipt across an epoch change', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.received('tenant:a', 1, 1020)
    book.startEpoch()
    book.acked('w1', 1, 'tenant:a', 1, 1040)

    expect(book.finalize(first)).toMatchObject({ ack: [40], fanout: [20], undelivered: 0 })
  })

  it('drops the receipts of an unacked push when its epoch is finalized', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.received('tenant:a', 5, 1020)
    book.finalize(first)

    const second = book.startEpoch()

    book.pushed('w1', 2, 'tenant:a', 2000, 1)
    book.acked('w1', 2, 'tenant:a', 5, 2010)

    expect(book.finalize(second).fanout).toEqual([])
  })

  it('keeps the receipts of a region that still has an unacked push in a live epoch', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)

    const second = book.startEpoch()

    book.pushed('w2', 1, 'tenant:a', 2000, 1)
    book.received('tenant:a', 5, 2020)
    book.finalize(first)
    book.acked('w2', 1, 'tenant:a', 5, 2030)

    expect(book.finalize(second).fanout).toEqual([20])
  })

  it('counts the pushes without an ack and the deliveries still missing', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 3)
    book.pushed('w1', 2, 'tenant:a', 1100, 3)
    book.pushed('w1', 3, 'tenant:a', 1200, 3)
    book.acked('w1', 1, 'tenant:a', 1, 1010)
    book.acked('w1', 2, 'tenant:a', 2, 1110)
    book.received('tenant:a', 1, 1020)
    book.received('tenant:a', 1, 1021)
    book.received('tenant:a', 1, 1022)
    book.received('tenant:a', 2, 1120)

    expect(book.status(epoch)).toEqual({ unacked: 1, undelivered: 2 })
    expect(book.finalize(epoch)).toMatchObject({
      pushes: 3,
      expected: 9,
      unacked: 1,
      undelivered: 2,
    })
  })
})
