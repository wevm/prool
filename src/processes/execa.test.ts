import * as NodeProcess from 'node:process'
import { EventEmitter } from 'eventemitter3'
import getPort from 'get-port'
import { afterEach, describe, expect, test } from 'vitest'
import { type ExecaStartOptions, execa } from './execa.js'

const processes: execa.ReturnType[] = []
function createProcess() {
  const process = execa({ name: 'foo' })
  processes.push(process)
  return process
}

afterEach(async () => {
  for (const process of processes) await process.stop().catch(() => {})
})

describe('execa', () => {
  test.each([0, 1])('rejects exit code %s before readiness', async (code) => {
    const process = createProcess()
    const emitter: ExecaStartOptions['emitter'] = new EventEmitter()
    await expect(
      process.start(
        ($) => $`${NodeProcess.execPath} -e ${`process.exit(${code})`}`,
        {
          emitter,
          status: 'starting',
          resolver() {},
        },
      ),
    ).rejects.toThrowError('Failed to start process "foo": exited')
  })

  test('keeps a restarted process alive after a previous resolver rejects', async () => {
    const process = createProcess()
    const emitter: ExecaStartOptions['emitter'] = new EventEmitter()
    const previousReject =
      Promise.withResolvers<(data: string) => Promise<void>>()
    const script = "process.stdout.write('ready'); setInterval(() => {}, 1000)"
    await process.start(($) => $`${NodeProcess.execPath} -e ${script}`, {
      emitter,
      status: 'starting',
      resolver({ process, reject, resolve }) {
        previousReject.resolve(reject)
        process.stdout.once('data', resolve)
      },
    })
    await process.stop()
    await process.start(($) => $`${NodeProcess.execPath} -e ${script}`, {
      emitter,
      status: 'starting',
      resolver({ process, resolve }) {
        process.stdout.once('data', resolve)
      },
    })

    const current = process._internal.process
    await (await previousReject.promise)('shutting down')
    expect(current.killed).toBe(false)
    expect(current.exitCode).toBeNull()
    expect(current.signalCode).toBeNull()
  })
})

test('default', async () => {
  const process = createProcess()
  expect(process).toMatchInlineSnapshot(`
    {
      "_internal": {
        "process": undefined,
      },
      "name": "foo",
      "start": [Function],
      "stop": [Function],
    }
  `)
})

test('start', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    listening: Promise.withResolvers<void>(),
    message: Promise.withResolvers<void>(),
    stdout: Promise.withResolvers<void>(),
  }
  emitter.on('listening', resolvers.listening.resolve)
  emitter.on('message', resolvers.message.resolve)
  emitter.on('stdout', resolvers.stdout.resolve)

  await process.start(($) => $`anvil --port 1337`, {
    emitter,
    status: 'idle',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  expect(process._internal.process).toBeDefined()
  await expect(resolvers.listening.promise).resolves.toBeUndefined()
  await expect(resolvers.message.promise).resolves.toBeDefined()
  await expect(resolvers.stdout.promise).resolves.toBeDefined()
})

test('start (error)', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    listening: Promise.withResolvers<void>(),
    message: Promise.withResolvers<void>(),
    stderr: Promise.withResolvers<void>(),
  }
  emitter.on('listening', resolvers.listening.resolve)
  emitter.on('message', resolvers.message.resolve)
  emitter.on('stderr', resolvers.stderr.resolve)

  // Invalid argument
  await expect(() =>
    process.start(($) => $`anvil --lol`, {
      emitter,
      status: 'idle',
      resolver({ process, reject, resolve }) {
        process.stdout.on('data', (data) => {
          const message = data.toString()
          if (message.includes('Listening on')) resolve()
        })
        process.stderr.on('data', reject)
      },
    }),
  ).rejects.toThrowError('Failed to start process "foo"')
  await expect(resolvers.message.promise).resolves.toBeDefined()
  await expect(resolvers.stderr.promise).resolves.toBeDefined()
})

test('behavior: exit', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    exit: Promise.withResolvers<void>(),
  }
  emitter.on('exit', resolvers.exit.resolve)

  // Invalid argument
  await process.start(($) => $`anvil --port 1338`, {
    emitter,
    status: 'idle',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  process._internal.process.kill()
  await expect(resolvers.exit.promise).resolves.toBeDefined()
})

test('behavior: exit when status is starting', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    exit: Promise.withResolvers<void>(),
  }
  emitter.on('exit', resolvers.exit.resolve)

  // Invalid argument
  const port = await getPort()
  await process.start(($) => $`anvil --port ${port}`, {
    emitter,
    status: 'starting',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  process._internal.process.kill()
  await expect(resolvers.exit.promise).resolves.toBeDefined()
})
