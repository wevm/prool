import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Images } from 'prool/testcontainers'
import { expect, test } from 'vitest'

const image = 'ghcr.io/tempoxyz/tempo:sha-9634fed'

test('waits until the lock file of the image is removed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prool-pulls-'))
  const lock = path.join(directory, 'ghcr.io_tempoxyz_tempo_sha-9634fed')
  fs.writeFileSync(lock, '')
  // Another image's lock does not hold the wait.
  fs.writeFileSync(path.join(directory, 'postgres_17-alpine'), '')
  setTimeout(() => fs.rmSync(lock), 700)

  const started = Date.now()
  await Images.pulled({ directory, image })
  expect(Date.now() - started).toBeGreaterThanOrEqual(600)
  expect(fs.existsSync(lock)).toBe(false)
})

test('returns at once without a directory or a lock file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prool-pulls-'))
  const started = Date.now()
  await Images.pulled({ directory: undefined, image })
  await Images.pulled({ directory, image })
  expect(Date.now() - started).toBeLessThan(100)
})

test('returns after the timeout', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prool-pulls-'))
  fs.writeFileSync(
    path.join(directory, 'ghcr.io_tempoxyz_tempo_sha-9634fed'),
    '',
  )
  const started = Date.now()
  await Images.pulled({ directory, image, timeout: 600 })
  expect(Date.now() - started).toBeGreaterThanOrEqual(500)
})
