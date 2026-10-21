// scenario: sync/05-idle-traffic
import { appReady, expect, test } from '../support/fixtures'

const MINUTE_MS = 60_000

/**
 * How far the page's clock moves at a time. The gateway answers, and the page stores what it
 * hears, in real time while the page's time jumps: a jump past a request still in hand fires the
 * app's 30-second answer timeout for an exchange done within milliseconds, and its resend would
 * count. So the idle time starts once the traffic of opening has settled, and moves a second at
 * a time, each once every frame the page sent has had its answer (the protocol answers every
 * request).
 */
const STEP_MS = 1_000

test.describe('Stay quiet while idle', { tag: '@full' }, () => {
  test('A visible tab with its sync channel up sends few sync frames while nobody uses it', async ({
    page,
    signedIn,
  }, testInfo) => {
    const data = {
      idleMinutes: '10',
      framesPerMinuteAtMost: '2',
    }
    const frames = { sent: 0, received: 0 }
    const errors: Array<Promise<string>> = []
    const answered = (): boolean => frames.received >= frames.sent
    let moved = -1
    /** Every request answered, and no frame since the last look. */
    const settled = (): boolean => {
      const now = frames.sent + frames.received
      const still = now === moved

      moved = now

      return still && answered()
    }

    // Frames on the page's sync socket, and on no other socket the page may open.
    page.on('websocket', (socket) => {
      if (socket.url().endsWith('/backend/sync')) {
        socket.on('framesent', () => {
          frames.sent += 1
        })
        socket.on('framereceived', () => {
          frames.received += 1
        })
      }
    })

    const start =
      await test.step("1. Put the page's clock under the test's control, open [/me] and wait until the sync channel is up and the catch-up after opening has settled", async () => {
        page.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(
              Promise.all(message.args().map((arg) => arg.jsonValue())).then(
                (values) => JSON.stringify(values),
                () => message.text(),
              ),
            )
          }
        })
        await page.clock.install()
        await page.goto('/me')
        await appReady(page)
        await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name)
        await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })
        // Until the idle time starts, the page's clock runs at the pace of the real one.
        await expect
          .poll(settled, {
            intervals: [1_000],
            timeout: 15_000,
            message: 'the sync traffic of opening settled',
          })
          .toBe(true)

        return { ...frames, at: await page.evaluate(() => Date.now()) }
      })

    await test.step("2. Leave the tab idle for the idle minutes of the page's time", async () => {
      for (let idle = 0; idle < Number(data.idleMinutes) * MINUTE_MS; idle += STEP_MS) {
        if (!answered()) {
          await expect.poll(answered, { message: 'the gateway answered the page' }).toBe(true)
        }

        await page.clock.runFor(STEP_MS)
      }
    })

    // Expected:
    // - The page reports no error, keeps checking in with the gateway, and sends at most the
    //   allowed number of sync frames per minute, on average over the idle time
    const minutes = ((await page.evaluate(() => Date.now())) - start.at) / MINUTE_MS
    const sent = frames.sent - start.sent
    const rate = sent / minutes

    expect(minutes, "the idle minutes of the page's time").toBeGreaterThanOrEqual(
      Number(data.idleMinutes),
    )
    expect(await Promise.all(errors), 'errors the page reported').toEqual([])
    await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up')
    expect(sent, 'sync frames sent while idle').toBeGreaterThan(0)
    expect(rate, 'sync frames sent per idle minute').toBeLessThanOrEqual(
      Number(data.framesPerMinuteAtMost),
    )
    // - The measured rate is reported as "idle-frames-per-minute"
    testInfo.annotations.push({ type: 'idle-frames-per-minute', description: rate.toFixed(2) })
  })
})
